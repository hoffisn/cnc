import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments } from 'three';
import { SegmentKind, findLastSegmentUpToLine, type Toolpath } from '@rezets/core';

const VERTICES_PER_SEGMENT = 2;

const FEED_LINE_COLOR = '#2b3a55';
const RAPID_LINE_COLOR = '#a9b0bb';
const COMPLETED_LINE_COLOR = '#f0b400';
const HIGHLIGHT_LINE_COLOR = '#e5484d';

/**
 * Draws a toolpath as lines. Everything shares one vertex buffer ordered as in the toolpath,
 * so the progress and highlight overlays are just draw ranges and update without touching the GPU data.
 */
export class ToolpathLines {
  readonly group = new Group();
  private readonly feedMaterial = new LineBasicMaterial({ color: FEED_LINE_COLOR });
  private readonly rapidMaterial = new LineBasicMaterial({ color: RAPID_LINE_COLOR, transparent: true, opacity: 0.55 });
  private readonly completedMaterial = new LineBasicMaterial({ color: COMPLETED_LINE_COLOR });
  private readonly highlightMaterial = new LineBasicMaterial({ color: HIGHLIGHT_LINE_COLOR });

  private toolpath: Toolpath | null = null;
  private geometries: BufferGeometry[] = [];
  private completedGeometry: BufferGeometry | null = null;
  private highlightGeometry: BufferGeometry | null = null;

  /** Rebuilds the lines for a new toolpath. */
  setToolpath(toolpath: Toolpath): void {
    this.clear();
    this.toolpath = toolpath;
    if (toolpath.segmentCount === 0) return;

    const positions = new Float32Array(toolpath.segmentCoordinates);
    const positionAttribute = new BufferAttribute(positions, 3);
    const createGeometry = (index: Uint32Array | null): BufferGeometry => {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', positionAttribute);
      if (index) geometry.setIndex(new BufferAttribute(index, 1));
      this.geometries.push(geometry);
      return geometry;
    };
    const addLines = (geometry: BufferGeometry, material: LineBasicMaterial, renderOrder: number): void => {
      const lines = new LineSegments(geometry, material);
      lines.frustumCulled = false;
      lines.renderOrder = renderOrder;
      this.group.add(lines);
    };

    addLines(createGeometry(this.collectVerticesOfKind(toolpath, SegmentKind.Feed)), this.feedMaterial, 1);
    addLines(createGeometry(this.collectVerticesOfKind(toolpath, SegmentKind.Rapid)), this.rapidMaterial, 1);

    this.completedGeometry = createGeometry(null);
    this.completedGeometry.setDrawRange(0, 0);
    addLines(this.completedGeometry, this.completedMaterial, 2);

    this.highlightGeometry = createGeometry(null);
    this.highlightGeometry.setDrawRange(0, 0);
    addLines(this.highlightGeometry, this.highlightMaterial, 3);
  }

  /** Marks segments up to and including the given index as completed; `-1` clears the mark. */
  setCompletedSegment(segmentIndex: number): void {
    this.completedGeometry?.setDrawRange(0, (segmentIndex + 1) * VERTICES_PER_SEGMENT);
  }

  /** Highlights all segments produced by a source line; `null` clears the highlight. */
  setHighlightedLine(sourceLine: number | null): void {
    const { toolpath, highlightGeometry } = this;
    if (!toolpath || !highlightGeometry) return;
    highlightGeometry.setDrawRange(0, 0);
    if (sourceLine === null) return;

    const lastSegment = findLastSegmentUpToLine(toolpath, sourceLine);
    if (lastSegment < 0 || toolpath.segmentSourceLines[lastSegment] !== sourceLine) return;

    let firstSegment = lastSegment;
    while (firstSegment > 0 && toolpath.segmentSourceLines[firstSegment - 1] === sourceLine) firstSegment -= 1;
    highlightGeometry.setDrawRange(
      firstSegment * VERTICES_PER_SEGMENT,
      (lastSegment - firstSegment + 1) * VERTICES_PER_SEGMENT,
    );
  }

  dispose(): void {
    this.clear();
    this.feedMaterial.dispose();
    this.rapidMaterial.dispose();
    this.completedMaterial.dispose();
    this.highlightMaterial.dispose();
  }

  private collectVerticesOfKind(toolpath: Toolpath, kind: SegmentKind): Uint32Array {
    let matchingCount = 0;
    for (let segment = 0; segment < toolpath.segmentCount; segment += 1) {
      if (toolpath.segmentKinds[segment] === kind) matchingCount += 1;
    }
    const indices = new Uint32Array(matchingCount * VERTICES_PER_SEGMENT);
    let writeIndex = 0;
    for (let segment = 0; segment < toolpath.segmentCount; segment += 1) {
      if (toolpath.segmentKinds[segment] === kind) {
        indices[writeIndex] = segment * VERTICES_PER_SEGMENT;
        indices[writeIndex + 1] = segment * VERTICES_PER_SEGMENT + 1;
        writeIndex += VERTICES_PER_SEGMENT;
      }
    }
    return indices;
  }

  private clear(): void {
    this.group.clear();
    for (const geometry of this.geometries) geometry.dispose();
    this.geometries = [];
    this.completedGeometry = null;
    this.highlightGeometry = null;
    this.toolpath = null;
  }
}
