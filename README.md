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
