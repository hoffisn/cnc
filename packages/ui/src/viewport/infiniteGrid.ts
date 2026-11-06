import { Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three';

const GRID_LINE_COLOR = new Color('#8a8f98');
const AXIS_X_COLOR = new Color('#e5484d');
const AXIS_Y_COLOR = new Color('#30a46c');

/** Plane size relative to the camera distance: far enough for the fade to hide its edge. */
const PLANE_SIZE_IN_CAMERA_DISTANCES = 40;
const FADE_DISTANCE_IN_CAMERA_DISTANCES = 12;
/** The cell size is the power of ten closest to this fraction of the camera distance. */
const CELL_SIZE_IN_CAMERA_DISTANCES = 1 / 8;

const VERTEX_SHADER = /* glsl */ `
  varying vec3 worldPosition;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    worldPosition = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  varying vec3 worldPosition;
  uniform float cellSize;
  uniform float fadeDistance;
  uniform vec3 focusPoint;
  uniform vec3 lineColor;
  uniform vec3 axisXColor;
  uniform vec3 axisYColor;

  float gridCoverage(vec2 point, float size) {
    vec2 scaled = point / size;
    vec2 distanceToLine = abs(fract(scaled - 0.5) - 0.5) / fwidth(scaled);
    return 1.0 - min(min(distanceToLine.x, distanceToLine.y), 1.0);
  }

  void main() {
    vec2 point = worldPosition.xy;
    float minorCoverage = gridCoverage(point, cellSize) * 0.22;
    float majorCoverage = gridCoverage(point, cellSize * 10.0) * 0.55;
    float fade = 1.0 - smoothstep(0.0, fadeDistance, distance(worldPosition, focusPoint));

    vec3 color = lineColor;
    float alpha = max(minorCoverage, majorCoverage);

    vec2 axisDistance = abs(point) / fwidth(point);
    if (axisDistance.y < 1.2) {
      color = axisXColor;
      alpha = 0.9;
    } else if (axisDistance.x < 1.2) {
      color = axisYColor;
      alpha = 0.9;
    }

    gl_FragColor = vec4(color, alpha * fade);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

/**
 * Workshop-style floor grid that looks the same at any zoom: a single shader-driven plane
 * replaces thousands of line objects, and the cell size follows the camera.
 */
export class InfiniteGrid {
  readonly mesh: Mesh<PlaneGeometry, ShaderMaterial>;
  private height = 0;

  constructor() {
    this.mesh = new Mesh(
      new PlaneGeometry(1, 1),
      new ShaderMaterial({
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: {
          cellSize: { value: 1 },
          fadeDistance: { value: 1 },
          focusPoint: { value: new Vector3() },
          lineColor: { value: GRID_LINE_COLOR },
          axisXColor: { value: AXIS_X_COLOR },
          axisYColor: { value: AXIS_Y_COLOR },
        },
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }

  /** Places the floor at the given Z, typically just under the figure. */
  setHeight(height: number): void {
    this.height = height;
  }

  /** Adapts the grid to the camera; call before each render. */
  followCamera(focusPoint: Vector3, cameraDistance: number): void {
    const planeSize = cameraDistance * PLANE_SIZE_IN_CAMERA_DISTANCES;
    this.mesh.position.set(focusPoint.x, focusPoint.y, this.height);
    this.mesh.scale.set(planeSize, planeSize, 1);

    const { uniforms } = this.mesh.material;
    (uniforms.cellSize as { value: number }).value =
      10 ** Math.round(Math.log10(cameraDistance * CELL_SIZE_IN_CAMERA_DISTANCES));
    (uniforms.fadeDistance as { value: number }).value = cameraDistance * FADE_DISTANCE_IN_CAMERA_DISTANCES;
    (uniforms.focusPoint as { value: Vector3 }).value.set(focusPoint.x, focusPoint.y, this.height);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
