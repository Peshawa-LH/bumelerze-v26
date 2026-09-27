export { axisColor, AXIS_CHIP_ON_FILL_TEXT } from "./colors";
export {
  ACCELEROMETER_UPDATE_INTERVAL_MS,
  MAX_PLOT_POINTS,
  PLOT_RENDER_INTERVAL_MS,
  PLOT_WINDOW_MS,
  RING_BUFFER_CAPACITY,
  SPACE_HALF_SPAN_G,
  SPACE_TRAIL_MS,
  TRACE_HALF_SPAN_G,
  WEB_SILENT_TIMEOUT_MS,
} from "./constants";
export { downsampleForPlot, selectWindow } from "./downsample";
export {
  GRAVITY_LOW_PASS_ALPHA,
  GravityFilter,
  removeGravityFromSeries,
} from "./low-pass-filter";
export { RingBuffer } from "./ring-buffer";
export type { AccelerometerVector, AxisKey, SensorSample, SensorView } from "./types";
export {
  useAccelerometerStream,
  type SensorStreamStatus,
  type UseAccelerometerStreamResult,
} from "./use-accelerometer-stream";
export { ChannelLegend } from "./components/ChannelLegend";
export { SpaceView } from "./components/SpaceView";
export { TraceStack } from "./components/TraceStack";
export { ViewSwitch } from "./components/ViewSwitch";
export { clamp, PHONE_EDGES, PHONE_HALF, phoneCorners, projectPoint } from "./projection";
