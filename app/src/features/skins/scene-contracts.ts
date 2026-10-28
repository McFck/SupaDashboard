export type SceneMode = 'live' | 'frozen';
export type SceneInput = {
  kind: 'down' | 'move' | 'up' | 'cancel';
  x: number;
  y: number;
  pointerId: number;
  pointerType: string;
  button: number;
  time: number;
  screenX?: number;
  screenY?: number;
};
export type SceneRect = { left: number; top: number; width: number; height: number };

export type SceneFrame<Data = unknown> = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  time: number;
  mode: SceneMode;
  view: string;
  data: Data;
};
export type SkinSceneRenderer<Data = unknown> = {
  draw(frame: SceneFrame<Data>): boolean;
  input?(event: SceneInput): void;
  dispose?(): void;
};
export type SkinSceneFactory<Data = unknown> = () => SkinSceneRenderer<Data>;
