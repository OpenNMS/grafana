define([
    'angular',
    'lodash',
    './queryCtrl',
    './modalCtrl',
    './directives'
  ],
function (angular, _) {
    'use strict';

    var module = angular.module('grafana.services');

    module.factory('OpenNMSDatasource', function ($q, $http, templateSrv) {

      function OpenNMSDatasource(datasource) {
        this.type = 'opennms';
        this.url = datasource.url;
        this.name = datasource.name;
        this.basicAuth = datasource.basicAuth;
        this.withCredentials = datasource.withCredentials;
        this.searchLimit = 25;

        this.supportMetrics = true;
      }

      // Called once per panel (graph)
      OpenNMSDatasource.prototype.query = function (options) {
        var _this = this;

        // Build the query
        var query = _this._buildQuery(options);

        // Make the request
        var request;
        if (query.source.length > 0) {
          // Only make the request if there is at lease one source
          request = this._onmsRequest('POST', '/rest/measurements', query);
        } else {
          // Otherwise return an empty set of measurements
          request = $q.defer();
          request.resolve({measurements: []});
        }

        // Process the results
        return $q.when(request).then(function (response) {
          return _this._processResponse(response);
        });
      };

      OpenNMSDatasource.prototype.metricFindQuery = function (query) {
        var interpolatedQuery;
        try {
          interpolatedQuery = templateSrv.replace(query);
        }
        catch (err) {
          return $q.reject(err);
        }

        var nodeFilterRegex = /nodeFilter\((.*)\)/;
        var nodeResourcesRegex = /nodeResources\((.*)\)/;

        if (interpolatedQuery !== undefined) {
          var nodeFilterQuery = interpolatedQuery.match(nodeFilterRegex);
          if (nodeFilterQuery) {
            return this._onmsRequest('GET', '/rest/nodes?filterRule=' + encodeURIComponent(nodeFilterQuery[1])).then(function (nodelist) {
              if (nodelist.count > nodelist.totalCount) {
                console.warn("Filter matches " + nodelist.totalCount + " records, but only " + nodelist.count + " will be used.");
              }
              var results = [];
              _.each(nodelist.node, function(node) {
                var nodeCriteria = node.id.toString();
                if (node.foreignId !== null && node.foreignSource !== null) {
                  nodeCriteria = node.foreignSource + ":" + node.foreignId;
                }
                results.push({text: nodeCriteria, expandable: true});
              });
              return results;
            });
          }

          var nodeCriteria = interpolatedQuery.match(nodeResourcesRegex);
          if (nodeCriteria) {
            return this._onmsRequest('GET', '/rest/resources/' + encodeURIComponent(this._getNodeResource(nodeCriteria[1])), {
              depth: 1
            }).then(function (data) {
              var results = [];
              _.each(data.children.resource, function(resource) {
                var resourceWithoutNodePrefix = resource.id.match(/node(Source)?\[.*?\]\.(.*)/);
                if (resourceWithoutNodePrefix) {
                  results.push({text: resourceWithoutNodePrefix[2], expandable: true});
                }
              });
              return results;
            });
          }
        }

        return $q.when([]);
      };

      OpenNMSDatasource.prototype.testDatasource = function() {
        return this._onmsRequest('GET', '/rest/info').then(function () {
          return { status: "success", message: "Data source is working", title: "Success" };
        });
      };

      /**
       * Combines all the targets in the panel in a single query,
       * this allows us to make a single round-trip, and take advantage of compression.
       */
      OpenNMSDatasource.prototype._buildQuery = function (options) {
        var _this = this;

        var start = options.range.from.valueOf(),
            end = options.range.to.valueOf(),
            step = Math.floor((end - start) / options.maxDataPoints);

        var query = {
          "start": start,
          "end": end,
          "step": step,
          "maxrows": options.maxDataPoints,
          "source": [],
          "expression": []
        };

        _.each(options.targets, function (target) {
          var transient = "false";
          if (target.hide) {
            transient = true;
          }

          if (target.type === "attribute") {
            if (!((target.nodeId && target.resourceId && target.attribute))) {
              return;
            }

            var label = target.label;
            if (label === undefined || label === '') {
              label = target.attribute;
            }

            // Build the source
            var source = {
              "aggregation": target.aggregation,
              "attribute": target.attribute,
              "label": label,
              "resourceId": _this._getRemoteResourceId(target.nodeId, target.resourceId),
              "transient": transient
            };

            if (target.subattribute !== undefined && target.subattribute !== '') {
              source.datasource = target.subattribute;
            }

            // Perform variable substitution - may generate additional queries
            query.source = query.source.concat(_this._interpolateSourceVariables(source));
          } else if (target.type === "expression") {
            if (!((target.label && target.expression))) {
              return;
            }

            // Build the expression
            var expression = {
              "label": target.label,
              "value": target.expression,
              "transient": transient
            };

            // Perform variable substitution - may generate additional expressions
            query.expression = query.expression.concat(_this.__interpolateExpressionVariables(expression));
          } else if (target.type === "filter") {
            if (!((target.filter))) {
              return;
            }

            // Build the filter
            var parameters = [];

            _.each(target.filterParameters, function(value, key) {
              // Skip parameters with undefined or empty values
              if (value === undefined || value === '' || value === null) {
                return;
              }

              parameters.push({
                'key': key,
                'value': value
              });
            });

            var filter = {
              "name": target.filter.name,
              "parameter": parameters
            };

            // Only add the filter attribute to the query when one or more filters are specified since
            // OpenNMS versions before 17.0.0 do not support it
            if (!query.filter) {
              query.filter = [filter];
            } else {
              query.filter = query.filter.concat(filter);
            }
          }
        });

        return query;
      };

      OpenNMSDatasource.prototype._interpolateSourceVariables = function(source) {
        return this.__interpolateVariables(source, ['resourceId', 'attribute', 'subattribute', 'label'], function(source) {
          // If we reference a variable in the node field, we will default to using the node[] resource type
          // even though the variable may contain a reference to the foreign source/id criteria.
          // If we hit such a case, replace the node[] resource type with the nodeSource resource type
          var nodeResourceRegex = /node\[(.*?):(.*?)\].*/;
          if (source.resourceId !== undefined && source.resourceId.match(nodeResourceRegex)) {
            source.resourceId = source.resourceId.replace(/^node/, "nodeSource");
          }
        });
      };

      OpenNMSDatasource.prototype.__interpolateExpressionVariables = function(expression) {
        return this.__interpolateVariables(expression, ['value', 'label']);
      };

      OpenNMSDatasource.prototype.__interpolateVariables = function(query, keys, callback) {

        // Collect the list of variables that are referenced in one or more of the keys
        var referencedVariables = [];
        _.each(templateSrv.variables, function(variable) {
          var isVariableReferenced = _.find(keys, function(key) {
            return templateSrv.containsVariable(query[key], variable.name);
          });
          if (isVariableReferenced) {
            referencedVariables.push(variable);
          }
        });

        // No variables are referenced, return the query as-is
        if (referencedVariables.length === 0) {
          return [query];
        }

        // Generate permutations of the variables
        var cartesianProductOfVariables = this._cartesianVariables(referencedVariables);

        // Build the resulting queries, performing the required variable substitution
        var queries = [];
        _.each(cartesianProductOfVariables, function(rowOfReferencedVariables) {

          var mapOfReferencedVariables = {};
          _.each(rowOfReferencedVariables, function(variable) {
            mapOfReferencedVariables[variable.name] = {'value': variable.current.value};
          });

          var q = _.clone(query);
          _.each(keys, function(key) {
            q[key] = templateSrv.replace(q[key], mapOfReferencedVariables);
          });

          if (callback !== undefined) {
            // Allows the caller to make any required updates after the variable
            // substitution has been performed
            callback(q);
          }

          queries.push(q);
        });

        return queries;
      };

      OpenNMSDatasource.prototype._cartesianVariables = function(variables) {
        // Collect the values from all of the variables
        var allValues = [];
        _.each(variables, function(variable) {
          var values;
          if (variable.current.text === "All") { // All?

            // The user selected the "All" value, so we gather include
            // the values of all the other possible options
            values = [];
            _.each(variables.options, function(option) {
              if (option.text !== "All") {
                values.push(option.value);
              }
            });
          } else if (_.isString(variable.current.value)) { // Single-valued?
            values = [variable.current.value];
          } else {
            values = variable.current.value;
          }

          allValues.push(values);
        });

        // Generate the cartesian product
        var productOfAllValues = this._cartesian(allValues);

        // Rebuild the variables
        var productOfAllVariables = [];
        _.each(productOfAllValues, function(rowOfValues) {
          var rowOfVariables = [];
          for (var i = 0, l = variables.length; i<l; i++) {
            // Deep clone
            var variable = JSON.parse(JSON.stringify(variables[i]));
            variable.current.value = rowOfValues[i];
            rowOfVariables.push(variable);
          }
          productOfAllVariables.push(rowOfVariables);
        });

        return productOfAllVariables;
      };

      OpenNMSDatasource.prototype._cartesian = function(arrays) {
        // Based on the code from http://stackoverflow.com/questions/15298912/
        // javascript-generating-combinations-from-n-arrays-with-m-elements
        var r = [], max = arrays.length-1;
        function helper(arr, i) {
          for (var j=0, l=arrays[i].length; j<l; j++) {
            var a = arr.slice(0); // clone arr
            a.push(arrays[i][j]);
            if (i===max) {
              r.push(a);
            } else {
              helper(a, i+1);
            }
          }
        }
        helper([], 0);
        return r;
      };

      OpenNMSDatasource.prototype._processResponse = function (response) {
        var labels = response.labels;
        var columns = response.columns;
        var timestamps = response.timestamps;
        var series = [];
        var i, j, nRows, nCols, datapoints;

        if (timestamps !== undefined) {
          nRows = timestamps.length;
          nCols = columns.length;

          for (i = 0; i < nCols; i++) {
            datapoints = [];
            for (j = 0; j < nRows; j++) {
              // Skip rows that are out-of-ranges - this can happen with RRD data in narrow time spans
              if (timestamps[j] < response.start || timestamps[j] > response.end) {
                continue;
              }

              datapoints.push([columns[i].values[j], timestamps[j]]);
            }

            series.push({
              target: labels[i],
              datapoints: datapoints
            });
          }
        }

        return {data: series };
      };

      function retry(deferred, callback, delay) {
        return callback().then(undefined, function (reason) {
          if (reason.status !== 0 || reason.status >= 300) {
            reason.message = 'OpenNMS Error: <br/>' + reason.data;
            deferred.reject(reason);
          }
          else {
            setTimeout(function () {
              return retry(deferred, callback, Math.min(delay * 2, 30000));
            }, delay);
          }
        });
      }

      OpenNMSDatasource.prototype._onmsRequest = function (method, url, data) {
        var _this = this;

        var deferred = $q.defer();

        retry(deferred, function () {
          var params = {};

          if (method === 'GET') {
            _.extend(params, data);
            data = null;
          }

          var options = {
            method: method,
            url: _this.url + url,
            params: params,
            data: data
          };

          if (_this.basicAuth || _this.withCredentials) {
            options.withCredentials = true;
          }
          if (_this.basicAuth) {
            options.headers = options.headers || {};
            options.headers.Authorization = _this.basicAuth;
          }

          return $http(options).success(function (data) {
            deferred.resolve(data);
          });
        }, 10);

        return deferred.promise;
      };

      function flattenResourcesWithAttributes(resources, resourcesWithAttributes) {
        _.each(resources, function (resource) {
          if (resource.rrdGraphAttributes !== undefined && Object.keys(resource.rrdGraphAttributes).length > 0) {
            resourcesWithAttributes.push(resource);
          }
          if (resource.children !== undefined && resource.children.resource.length > 0) {
            flattenResourcesWithAttributes(resource.children.resource, resourcesWithAttributes);
          }
        });
        return resourcesWithAttributes;
      }

      OpenNMSDatasource.prototype.getResourcesWithAttributesForNode = function (nodeId) {
        return this._onmsRequest('GET', '/rest/resources/fornode/' + encodeURIComponent(nodeId), {
          depth: -1
        }).then(function (root) {
          return flattenResourcesWithAttributes([root], []);
        });
      };

      OpenNMSDatasource.prototype._getNodeResource = function (nodeId) {
        var prefix = "";
        if (nodeId.indexOf(":") > 0) {
          prefix = "nodeSource[";
        } else {
          prefix = "node[";
        }
        return prefix + nodeId + "]";
      };

      OpenNMSDatasource.prototype._getRemoteResourceId = function (nodeId, resourceId) {
        return this._getNodeResource(nodeId) + "." + resourceId;
      };

      OpenNMSDatasource.prototype.suggestAttributes = function (nodeId, resourceId, query) {
        return this._onmsRequest('GET', '/rest/resources/' + encodeURIComponent(this._getRemoteResourceId(nodeId, resourceId)), {
          depth: -1
        }).then(function (data) {
          query = query.toLowerCase();

          var attributes = [];
          _.each(data.rrdGraphAttributes, function (value, key) {
            if (key.toLowerCase().indexOf(query) >= 0) {
              attributes.push(key);
            }
          });
          attributes.sort();

          return attributes;
        });
      };

      OpenNMSDatasource.prototype.searchForNodes = function (query) {
        var _this = this;
        return this._onmsRequest('GET', '/rest/nodes', {
          limit: _this.searchLimit,
          match: 'any',
          comparator: 'ilike',
          orderBy: 'id',
          order: 'asc',
          label: '%' + query + '%',
          sysName: '%' + query + '%',
          'ipInterface.ipAddress': '%' + query + '%',
          'ipInterface.ipHostName': '%' + query + '%',
          'foreignId': query + '%' // doesn't support leading '%'
        });
      };

      OpenNMSDatasource.prototype.getAvailableFilters = function () {
        return this._onmsRequest('GET', '/rest/measurements/filters').then(function (data) {
          return data;
        });
      };

      return OpenNMSDatasource;
    });

  });
