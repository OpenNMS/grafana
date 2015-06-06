define([
  'helpers',
  'plugins/datasource/opennms/datasource'
], function (helpers) {
  'use strict';

  describe('OpenNMSDatasource', function () {
    var ctx = new helpers.ServiceTestContext();

    beforeEach(module('grafana.services'));
    beforeEach(ctx.providePhase(['templateSrv']));
    beforeEach(ctx.createService('OpenNMSDatasource'));
    beforeEach(function () {
      ctx.ds = new ctx.service({url: [''], user: 'test', password: 'mupp'});
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

    describe('When issuing annotation query', function () {
      var results;
      // var urlExpected = "/rest/events?node.id=9&eventTime=<timestamp here>&comparator=ge&orderBy=eventTime&order=desc&limit=100";

      var response = {
        "count": 1,
        "totalCount": 91670,
        "event": [
          {
            "ifIndex": null,
            "id": 1837330,
            "serviceType": {
              "name": "DNS",
              "id": 12
            },
            "nodeId": 9,
            "nodeLabel": "cartman.internal.opennms.com",
            "uei": "uei.opennms.org/nodes/nodeRegainedService",
            "time": 1433614963908,
            "host": "mephesto.internal.opennms.com",
            "source": "OpenNMS.Poller.DefaultPollContext",
            "createTime": 1433614963931,
            "description": "<p>The DNS service on interface 2001:0470:e2f1:0000:0000:0000:0000:000a was\n      previously down and has been restored.</p>\n      <p>This event is generated when a service which had\n      previously failed polling attempts is again responding to\n      polls by OpenNMS. </p> <p>This event will cause\n      any active outages associated with this service/interface\n      combination to be cleared.</p>",
            "logMessage": "The DNS outage on interface 2001:0470:e2f1:0000:0000:0000:0000:000a has been\n      cleared. Service is restored.",
            "log": "Y",
            "display": "Y",
            "ipAddress": "2001:0470:e2f1:0000:0000:0000:0000:000a",
            "severity": "NORMAL"
          }
        ]
      };

      beforeEach(function() {
        var annotation = {"nodeId": 9};
        var range = {"from": "1433614963908", "to":"now"};

        ctx.$httpBackend.expectGET(undefined).respond(response);
        ctx.ds.annotationQuery(annotation, range).then(function(data) {
          results = data;
        });
        ctx.$httpBackend.flush();
      });

      it('should return a result', function () {
        expect(results.length).to.be(1);
        expect(results[0].time).to.be(1433614963908);
        expect(results[0].title).to.be("uei.opennms.org/nodes/nodeRegainedService on cartman.internal.opennms.com");
      });
    });

  });

});
