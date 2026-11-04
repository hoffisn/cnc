import { ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, type Vector3 as ThreeVector3 } from 'three';
import type { Vector3 } from '@rezets/core';

const BODY_COLOR = '#ffdd2d';
const TIP_COLOR = '#1c1c1e';
/** Marker height relative to the camera distance, so it keeps a constant size on screen. */
const SIZE_IN_CAMERA_DISTANCES = 0.045;

/** Stylized cutter showing where the machine is right now. Its tip marks the exact position. */
export class ToolMarker {
  readonly group = new Group();
  private readonly bodyGeometry = new CylinderGeometry(0.28, 0.28, 0.7, 32);
  private readonly tipGeometry = new ConeGeometry(0.28, 0.3, 32);
  private readonly bodyMaterial = new MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.4 });
  private readonly tipMaterial = new MeshStandardMaterial({ color: TIP_COLOR, roughness: 0.4 });

  constructor() {
    const tip = new Mesh(this.tipGeometry, this.tipMaterial);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = 0.15;
    const body = new Mesh(this.bodyGeometry, this.bodyMaterial);
    body.rotation.x = Math.PI / 2;
    body.position.z = 0.65;
    this.group.add(tip, body);
    this.group.traverse((object) => {
      object.frustumCulled = false;
    });
  }

  setPosition(position: Vector3): void {
    this.group.position.set(position.x, position.y, position.z);
  }

  /** Keeps the marker the same size on screen; call before each render. */
  followCamera(cameraPosition: ThreeVector3): void {
    this.group.scale.setScalar(this.group.position.distanceTo(cameraPosition) * SIZE_IN_CAMERA_DISTANCES);
  }

  dispose(): void {
    this.bodyGeometry.dispose();
    this.tipGeometry.dispose();
    this.bodyMaterial.dispose();
    this.tipMaterial.dispose();
  }
}
