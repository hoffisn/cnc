import {
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector3 as ThreeVector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { boundsCenter, boundsSize, type Bounds, type Relief, type Toolpath, type Vector3 } from '@rezets/core';
import { InfiniteGrid } from './infiniteGrid';
import { ReliefMesh, computeReliefBaseZ } from './reliefMesh';
import { ToolMarker } from './toolMarker';
import { ToolpathLines } from './toolpathLines';
import { CameraPreset, ViewportMode } from './viewportTypes';

const BACKGROUND_COLOR = '#eef0f3';
const CAMERA_FOV_DEGREES = 38;
const MAX_PIXEL_RATIO = 2;
/** Empty space around a fitted figure. */
const FIT_MARGIN = 1.25;
/** Camera distance used when there is nothing to fit, in millimeters. */
const DEFAULT_VIEW_RADIUS_MM = 100;
const MIN_VIEW_RADIUS_MM = 1;
const GRID_CLEARANCE_RATIO = 0.02;
const MIN_GRID_CLEARANCE_MM = 0.01;

/** Direction from the look-at point to the camera, for each preset. */
const PRESET_DIRECTIONS: Readonly<Record<CameraPreset, ThreeVector3>> = {
  [CameraPreset.Isometric]: new ThreeVector3(0.75, -1, 0.85).normalize(),
  [CameraPreset.Top]: new ThreeVector3(0, -0.0001, 1).normalize(),
  [CameraPreset.Front]: new ThreeVector3(0, -1, 0.0001).normalize(),
  [CameraPreset.Right]: new ThreeVector3(1, 0, 0.0001).normalize(),
};

/**
 * The 3D scene behind the viewport: a plain class that knows nothing about Vue.
 * Rendering happens only on demand, so an idle machine screen uses no GPU.
 */
export class ToolpathViewport {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.1, 10000);
  private readonly controls: OrbitControls;
  private readonly grid = new InfiniteGrid();
  private readonly toolpathLines = new ToolpathLines();
  private readonly reliefMesh = new ReliefMesh();
  private readonly toolMarker = new ToolMarker();
  private readonly resizeObserver: ResizeObserver;

  private mode = ViewportMode.Part;
  private relief: Relief | null = null;
  private lowestTravelZ = 0;
  private toolpathBounds: Bounds | null = null;
  private framedBounds: Bounds | null = null;
  private renderFrameId: number | null = null;

  constructor(private readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(BACKGROUND_COLOR);
    this.scene.add(new HemisphereLight('#ffffff', '#9aa3b2', 1.9));
    const keyLight = new DirectionalLight('#ffffff', 1.8);
    keyLight.position.set(1, -1.4, 2.2);
    this.scene.add(keyLight);
    this.scene.add(this.grid.mesh, this.reliefMesh.mesh, this.toolpathLines.group, this.toolMarker.group);

    // Machine convention: Z points up. It must be set before the controls capture the camera's up axis.
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.requestRender());

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();
    this.applyCameraPreset(CameraPreset.Isometric);
  }

  setToolpath(toolpath: Toolpath): void {
    this.toolpathLines.setToolpath(toolpath);
    this.toolpathBounds = toolpath.partBounds ?? toolpath.travelBounds;
    this.lowestTravelZ = toolpath.travelBounds?.min.z ?? 0;
    this.placeGridUnderFigure();
    this.requestRender();
  }

  setRelief(relief: Relief | null): void {
    this.reliefMesh.setRelief(relief);
    this.relief = relief;
    this.placeGridUnderFigure();
    this.applyMode();
  }

  setMode(mode: ViewportMode): void {
    this.mode = mode;
    this.applyMode();
  }

  setToolPosition(position: Vector3): void {
    this.toolMarker.setPosition(position);
    this.requestRender();
  }

  /** @param segmentIndex - Last completed segment; `-1` clears the progress. */
  setCompletedSegment(segmentIndex: number): void {
    this.toolpathLines.setCompletedSegment(segmentIndex);
    this.requestRender();
  }

  setHighlightedLine(sourceLine: number | null): void {
    this.toolpathLines.setHighlightedLine(sourceLine);
    this.requestRender();
  }

  /** Sets what the camera should frame instead of the toolpath, such as the whole sheet; 
ull frames the toolpath. */
  setFramedBounds(bounds: Bounds | null): void {
    this.framedBounds = bounds;
  }

  /** Frames the whole figure, keeping the current view direction. */
  fitToFigure(): void {
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    this.frameFigure(direction);
  }

  applyCameraPreset(preset: CameraPreset): void {
    this.frameFigure(PRESET_DIRECTIONS[preset]);
  }

  dispose(): void {
    if (this.renderFrameId !== null) cancelAnimationFrame(this.renderFrameId);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.grid.dispose();
    this.toolpathLines.dispose();
    this.reliefMesh.dispose();
    this.toolMarker.dispose();
    this.renderer.dispose();
    // Browsers allow few live WebGL contexts, and this viewport is recreated on every section change.
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** The floor must stay strictly below the figure, or its lines show through surfaces at the same height. */
  private placeGridUnderFigure(): void {
    const figureBottomZ = Math.min(this.lowestTravelZ, 0, this.relief ? computeReliefBaseZ(this.relief) : 0);
    const clearance = Math.max(Math.abs(figureBottomZ) * GRID_CLEARANCE_RATIO, MIN_GRID_CLEARANCE_MM);
    this.grid.setHeight(figureBottomZ - clearance);
  }

  private applyMode(): void {
    const showsPart = this.mode === ViewportMode.Part && this.relief !== null;
    this.reliefMesh.mesh.visible = showsPart;
    this.toolpathLines.group.visible = !showsPart;
    this.requestRender();
  }

  private frameFigure(direction: ThreeVector3): void {
    let center = new ThreeVector3();
    let radius = DEFAULT_VIEW_RADIUS_MM;
    const bounds = this.framedBounds ?? this.toolpathBounds;
    if (bounds) {
      const { x: centerX, y: centerY, z: centerZ } = boundsCenter(bounds);
      const size = boundsSize(bounds);
      center = new ThreeVector3(centerX, centerY, centerZ);
      radius = Math.max(Math.hypot(size.x, size.y, size.z) / 2, MIN_VIEW_RADIUS_MM);
    }

    const halfFov = (CAMERA_FOV_DEGREES * Math.PI) / 360;
    const horizontalHalfFov = Math.atan(Math.tan(halfFov) * this.camera.aspect);
    const distance = (radius * FIT_MARGIN) / Math.sin(Math.min(halfFov, horizontalHalfFov));

    this.controls.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.controls.update();
    this.requestRender();
  }

  private handleResize(): void {
    const { clientWidth: width, clientHeight: height } = this.container;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderNow();
  }

  private requestRender(): void {
    if (this.renderFrameId !== null) return;
    this.renderFrameId = requestAnimationFrame(() => {
      this.renderFrameId = null;
      // While damping settles, update() fires "change", which schedules the next frame.
      this.controls.update();
      this.renderNow();
    });
  }

  private renderNow(): void {
    const cameraDistance = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = cameraDistance / 200;
    this.camera.far = cameraDistance * 100;
    this.camera.updateProjectionMatrix();
    this.grid.followCamera(this.controls.target, cameraDistance);
    this.toolMarker.followCamera(this.camera.position);
    this.renderer.render(this.scene, this.camera);
  }
}
