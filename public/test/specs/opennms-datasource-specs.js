define([
  './helpers',
  'app/plugins/datasource/opennms/datasource'
], function (helpers) {
  'use strict';

  describe('OpenNMSDatasource', function () {
    var ctx = new helpers.ServiceTestContext();

    beforeEach(module('grafana.services'));
    beforeEach(inject(function(templateSrv) {
      ctx.templateSrv = templateSrv;
    }));
    beforeEach(ctx.createService('OpenNMSDatasource'));
    beforeEach(function () {
      ctx.ds = new ctx.service({url: [''], user: 'test', password: 'test'});
    });

    describe('When querying OpenNMS with one target', function () {
      var results;

      var query = {
        range: {from: 'now-1h', to: 'now'},
        targets: [{type:"attribute", nodeId: '1', resourceId: 'nodeSnmp[]', attribute: 'loadavg1', aggregation: 'AVERAGE'}],
        interval: '1s'
      };

      var urlExpected = "/rest/measurements";
      var response = {
        "step": 300000,
        "start": 1424211730000,
        "end": 1424226130000,
        "timestamps": [1424211730001],
        "labels": ["loadavg1"],
        "columns": [
          {
            "values": [5.0]
          }
        ]
      };

      beforeEach(function () {
        ctx.$httpBackend.expect('POST', urlExpected).respond(response);
        ctx.ds.query(query).then(function (data) {
          results = data;
        });
        ctx.$httpBackend.flush();
      });

      it('should generate the correct query', function () {
        ctx.$httpBackend.verifyNoOutstandingExpectation();
      });

      it('should return series list', function () {
        expect(results.data.length).to.be(1);
        expect(results.data[0].target).to.be('loadavg1');
        expect(results.data[0].datapoints.length).to.be(1);
      });

    });

    describe('When testing for connectivity', function () {
      it('should make a request to /rest/info', function () {
        ctx.$httpBackend.expect('GET', "/rest/info").respond({});
        ctx.ds.testDatasource();
        ctx.$httpBackend.flush();
        ctx.$httpBackend.verifyNoOutstandingExpectation();
      });
    });

    describe('When using templates', function () {
      var request;

      beforeEach(function () {
        ctx.$httpBackend.expect('POST', "/rest/measurements").respond(function(method, url, json) {
          request = JSON.parse(json);
          return {};
        });
      });

      it('should perform simple variable substitution', function () {
        ctx.templateSrv.init([{ name: 'variable', current: { value: 'loadavg1' }}]);

        var query = {
          range: {from: 'now-1h', to: 'now'},
          targets: [{type:"attribute", nodeId: '1', resourceId: 'nodeSnmp[]', attribute: '$variable', aggregation: 'AVERAGE'}],
          interval: '1s'
        };

        ctx.ds.query(query);

        ctx.$httpBackend.flush();
        ctx.$httpBackend.verifyNoOutstandingExpectation();

        expect(request.source.length).to.be(1);
        expect(request.source[0].attribute).to.be("loadavg1");
      });

      it('should generate multiple sources for multi-valued template variables', function () {
        ctx.templateSrv.init([
          { name: 'v1', current: { value: ['1', '2'] }},
          { name: 'v2', current: { value: ['x', 'y'] }}
        ]);

        var query = {
          range: {from: 'now-1h', to: 'now'},
          targets: [{type:"attribute", nodeId: '1', resourceId: 'nodeSnmp[]', attribute: '$v1-$v2', aggregation: 'AVERAGE'}],
          interval: '1s'
        };

        ctx.ds.query(query);

        ctx.$httpBackend.flush();
        ctx.$httpBackend.verifyNoOutstandingExpectation();

        expect(request.source.length).to.be(4);
        expect(request.source[0].attribute).to.be("1-x");
        expect(request.source[1].attribute).to.be("1-y");
        expect(request.source[2].attribute).to.be("2-x");
        expect(request.source[3].attribute).to.be("2-y");
      });

      it('should refer to nodeSource[] or node[] resources based on the resolved values', function () {
        ctx.templateSrv.init([
          { name: 'nodes', current: { value: ['1', '2', 'FS:FID'] }}
        ]);

        var query = {
          range: {from: 'now-1h', to: 'now'},
          targets: [{type:"attribute", nodeId: '$nodes', resourceId: 'nodeSnmp[]', attribute: 'loadavg1', aggregation: 'AVERAGE'}],
          interval: '1s'
        };

        ctx.ds.query(query);

        ctx.$httpBackend.flush();
        ctx.$httpBackend.verifyNoOutstandingExpectation();

        expect(request.source.length).to.be(3);
        expect(request.source[0].resourceId).to.be("node[1].nodeSnmp[]");
        expect(request.source[1].resourceId).to.be("node[2].nodeSnmp[]");
        expect(request.source[2].resourceId).to.be("nodeSource[FS:FID].nodeSnmp[]");
      });
    });

    describe('When using metric queries', function () {
      it('should support retrieving nodes by filter', function () {

        ctx.$httpBackend.expect('GET', "/rest/nodes?filterRule=(IPADDR%20!%3D%20'0.0.0.0')%20%26%20" +
                                          "catincProduction%20%26%20catincLinux").respond({
          "count": 2,
          "offset": null,
          "totalCount": 2,
          "node": [
            {
              "label": "node1",
              "categories": [],
              "foreignSource": null,
              "foreignId": null,
              "id": 1
            },
            {
              "label": "node2",
              "categories": [],
              "foreignSource": "FS",
              "foreignId": "FID",
              "id": 2
            }
          ]
        });

        var results = {};
        ctx.ds.metricFindQuery("nodeFilter((IPADDR != '0.0.0.0') & catincProduction & catincLinux)").then(function (data) {
          results = data;
        });

        ctx.$httpBackend.flush();
        ctx.$httpBackend.verifyNoOutstandingExpectation();

        expect(results.length).to.be(2);
        expect(results[0].text).to.be("1");
        expect(results[1].text).to.be("FS:FID");
      });

      it('should support retrieving child resources', function () {

        ctx.$httpBackend.expect('GET', "/rest/resources/node%5B2%5D?depth=1").respond({
          "id": "node[2]",
          "label": "internet",
          "name": "2",
          "link": "element/node.jsp?node=2",
          "typeLabel": "Node",
          "parentId": null,
          "children": {
            "count": 1,
            "totalCount": 1,
            "resource": [
              {
                "id": "node[2].responseTime[4.2.2.2]"
              },
              {
                "id": "node[2].responseTime[8.8.8.8]"
              }
            ]
          }
        });

        var results = {};
        ctx.ds.metricFindQuery("nodeResources(2)").then(function (data) {
          results = data;
        });

        ctx.$httpBackend.flush();
        ctx.$httpBackend.verifyNoOutstandingExpectation();

        expect(results.length).to.be(2);
        expect(results[0].text).to.be("responseTime[4.2.2.2]");
        expect(results[1].text).to.be("responseTime[8.8.8.8]");
      });
    });

    describe('Cartesian products', function () {
      it('should work with a single single-valued variable', function () {
        var results = ctx.ds._cartesianVariables([{ name: 'variable', current: { value: 'loadavg1'}}]);
        expect(results.length).to.be(1);

        expect(results[0][0].name).to.be('variable');
        expect(results[0][0].current.value).to.be('loadavg1');
      });

      it('should work with a single multi-valued variable', function () {
        var results = ctx.ds._cartesianVariables([{ name: 'variable', current: { value: ['loadavg1', 'loadavg5'] }}]);
        expect(results.length).to.be(2);
        expect(results[0][0].name).to.be('variable');
        expect(results[0][0].current.value).to.be('loadavg1');

        expect(results[1][0].name).to.be('variable');
        expect(results[1][0].current.value).to.be('loadavg5');
      });

      it('should work with multiple multi-valued variables', function () {
        var results = ctx.ds._cartesianVariables([
          { name: 'x', current: { value: ['1', '2'] }},
          { name: 'y', current: { value: ['A', 'B'] }}
        ]);
        expect(results.length).to.be(4);

        expect(results[0][0].name).to.be('x');
        expect(results[0][0].current.value).to.be('1');
        expect(results[0][1].name).to.be('y');
        expect(results[0][1].current.value).to.be('A');

        expect(results[1][0].name).to.be('x');
        expect(results[1][0].current.value).to.be('1');
        expect(results[1][1].name).to.be('y');
        expect(results[1][1].current.value).to.be('B');

        expect(results[2][0].name).to.be('x');
        expect(results[2][0].current.value).to.be('2');
        expect(results[2][1].name).to.be('y');
        expect(results[2][1].current.value).to.be('A');

        expect(results[3][0].name).to.be('x');
        expect(results[3][0].current.value).to.be('2');
        expect(results[3][1].name).to.be('y');
        expect(results[3][1].current.value).to.be('B');
      });
    });
  });
});
