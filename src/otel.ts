import path from "path";
import protobufjs from "protobufjs";

const metricProtos = [
  "opentelemetry.proto.metrics.v1.and",
  "opentelemetry.proto.metrics.v1.there",
  "opentelemetry.proto.metrics.v1.MetricsData",
  "opentelemetry.proto.metrics.v1.ResourceMetrics",
  "opentelemetry.proto.metrics.v1.ScopeMetrics",
  "opentelemetry.proto.metrics.v1.Metric",
  "opentelemetry.proto.metrics.v1.Gauge",
  "opentelemetry.proto.metrics.v1.Sum",
  "opentelemetry.proto.metrics.v1.Histogram",
  "opentelemetry.proto.metrics.v1.ExponentialHistogram",
  "opentelemetry.proto.metrics.v1.Summary",
  "opentelemetry.proto.metrics.v1.NumberDataPoint",
  "opentelemetry.proto.metrics.v1.HistogramDataPoint",
  "opentelemetry.proto.metrics.v1.ExponentialHistogramDataPoint",
  "opentelemetry.proto.metrics.v1.Buckets",
  "opentelemetry.proto.metrics.v1.SummaryDataPoint",
  "opentelemetry.proto.metrics.v1.ValueAtQuantile",
  "opentelemetry.proto.metrics.v1.Exemplar",
];

const commonPath = "opentelemetry/proto/";
const protoBaseDir = path.join(__dirname, "..", commonPath);
const protoFilePaths = [
  "collector/metrics/v1/metrics_service.proto",
  "collector/trace/v1/trace_service.proto",
];

const root = new protobufjs.Root();

root.resolvePath = function (origin, target) {
  return path.join(protoBaseDir, target.replace(commonPath, ""));
};

root.loadSync(protoFilePaths);

const ExportMetricsServiceRequest = root.lookupType(
  "opentelemetry.proto.collector.metrics.v1.ExportMetricsServiceRequest"
);

const ExportTraceServiceRequest = root.lookupType(
  "opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest"
);

export const otelProto = {
  ExportMetricsServiceRequest,
  ExportTraceServiceRequest,
};
