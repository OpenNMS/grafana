# Grafana @ OpenNMS

This fork of Grafana is used to maintain the [OpenNMS Grafana Plugin](http://www.opennms.org/wiki/Grafana).

Take a look at our [Wiki page](http://www.opennms.org/wiki/Grafana) for details on how to get started.

## Notes on this repository

The *features/opennms* branch of this repository should be kept up-to-date with the latest release branch upstream (currently 2.1.x).

Refer to the Grafana's documentation for details on building from source.

.deb and .rpm packages can be generated using:

```
go run build.go build package
```

## Changelog

### v1.1.0

* Added support for both single-valued and multi-valued template variables
* Added support for testing the datasource, introduced in Grafana 2.1.0
* Help information is now available in the datasource editor
* Added support for filters, available in Horizon 17.0.0

### v1.0.0-rc1

* Initial datasource implementation
