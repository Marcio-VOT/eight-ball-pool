import * as THREE from 'three';
import {
  BALL_RADIUS,
  CORNER_OPEN,
  CUSHION_SEGMENTS,
  HEAD_STRING_X,
  PLAY_HALF_LENGTH,
  PLAY_HALF_WIDTH,
  POCKETS,
  SIDE_OPEN,
} from '@/engine/constants';
import type { BallState } from '@/engine/types';
import type { InterpolatedBallPose } from '@/engine/timeline';
import type { AimGuideResult } from './aimGuide';
import {
  createBallTexture,
  createChalkTipTexture,
  createCueButtTexture,
  createCueShaftTexture,
  createFeltTextures,
  createFloorPlankTexture,
  createShadowTexture,
  createWoodTextures,
} from './textures';

export type CameraPreset = 'classic' | 'angled' | 'top';

export interface AimVisualState {
  visible: boolean;
  cueX: number;
  cueZ: number;
  angle: number;
  power: number;
  tipX: number;
  tipY: number;
  guide: AimGuideResult | null;
  ballInHandMode: boolean;
  ballInHandValid: boolean;
  showKitchen: boolean;
}

interface DropAnim {
  ballId: number;
  startX: number;
  startZ: number;
  pocketX: number;
  pocketZ: number;
  elapsed: number;
}

function shapeFromXZ(points: ReadonlyArray<readonly [number, number]>): THREE.Shape {
  const shape = new THREE.Shape();
  for (let i = 0; i < points.length; i++) {
    const [wx, wz] = points[i];
    if (i === 0) shape.moveTo(wx, -wz);
    else shape.lineTo(wx, -wz);
  }
  shape.closePath();
  return shape;
}

function extrudeXZ(
  shape: THREE.Shape,
  height: number,
  bevelSize = 0,
  bevelThickness = 0,
  bevelSegments = 1
): THREE.ExtrudeGeometry {
  const bevelEnabled = bevelSize > 0 && bevelThickness > 0;
  const innerDepth = bevelEnabled ? Math.max(0.001, height - bevelThickness * 2) : height;
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: innerDepth,
    bevelEnabled,
    bevelSize,
    bevelThickness,
    bevelSegments,
    curveSegments: 12,
  });
  // Map (shapeX, shapeY, extrudeZ) -> (worldX, worldY, worldZ)
  geo.rotateX(-Math.PI / 2);
  if (bevelEnabled) {
    geo.translate(0, bevelThickness, 0);
  }
  return geo;
}

export class PoolRenderer3D {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private cueScene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private cameraPreset: CameraPreset = 'classic';

  private ballMeshes: THREE.Mesh[] = [];
  private ballShadows: THREE.Mesh[] = [];
  private ballQuats: THREE.Quaternion[] = [];
  private dropAnims = new Map<number, DropAnim>();

  private cuePivot: THREE.Group;
  private cueGroup: THREE.Group;
  private cueShadowPivot: THREE.Group;
  private cueShadowGroup: THREE.Group;
  private strikeAnim: {
    active: boolean;
    elapsed: number;
    duration: number;
    startPull: number;
    onImpact: (() => void) | null;
  } = { active: false, elapsed: 0, duration: 0.075, startPull: 0, onImpact: null };

  // Aiming guide meshes (ribbons instead of 1px WebGL lines for crispness on Windows ANGLE)
  private aimGroup: THREE.Group;
  private cueRayMesh: THREE.Mesh;
  private cueRayMat: THREE.MeshBasicMaterial;
  private ghostRingMesh: THREE.Mesh;
  private ghostRingMat: THREE.MeshBasicMaterial;
  private ghostFillMesh: THREE.Mesh;
  private ghostFillMat: THREE.MeshBasicMaterial;
  private targetRayMesh: THREE.Mesh;
  private targetRayMat: THREE.MeshBasicMaterial;
  private postRayMesh: THREE.Mesh;
  private postRayMat: THREE.MeshBasicMaterial;
  private invalidXGroup: THREE.Group;

  // Ball-in-hand helpers
  private kitchenOverlay: THREE.Mesh;
  private cuePlacementRing: THREE.Mesh;
  private cuePlacementRingMat: THREE.MeshBasicMaterial;

  // Raycast helpers
  private raycaster = new THREE.Raycaster();
  private ballCenterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -BALL_RADIUS);
  private tmpVec2 = new THREE.Vector2();
  private tmpVec3 = new THREE.Vector3();
  private tmpAxis = new THREE.Vector3();
  private tmpQuat = new THREE.Quaternion();

  private disposables: Array<{ dispose: () => void }> = [];
  private resizeObserver: ResizeObserver;
  private disposed = false;

  constructor(container: HTMLElement) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0e0805');

    // Dedicated overlay scene for the cue stick so it renders cleanly above all balls & rails
    this.cueScene = new THREE.Scene();

    const width = Math.max(container.clientWidth, 320);
    const height = Math.max(container.clientHeight, 240);

    this.camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 20);
    this.applyCameraPreset('classic', width / height);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.autoClear = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    container.appendChild(this.renderer.domElement);

    this.setupLighting();
    this.buildRoomFloor();
    this.buildTable();
    this.buildBalls();

    const { pivot, group, shadowPivot, shadowGroup } = this.buildCueStick();
    this.cuePivot = pivot;
    this.cueGroup = group;
    this.cueShadowPivot = shadowPivot;
    this.cueShadowGroup = shadowGroup;
    this.cueScene.add(this.cuePivot);
    this.scene.add(this.cueShadowPivot);

    // Build Aiming Guides
    this.aimGroup = new THREE.Group();
    this.scene.add(this.aimGroup);

    const rayGeo = new THREE.PlaneGeometry(1, 0.0032);
    rayGeo.rotateX(-Math.PI / 2);
    this.disposables.push(rayGeo);

    this.cueRayMat = new THREE.MeshBasicMaterial({
      color: 0xf4ead2,
      transparent: true,
      opacity: 0.86,
      depthWrite: false,
    });
    this.cueRayMesh = new THREE.Mesh(rayGeo, this.cueRayMat);
    this.aimGroup.add(this.cueRayMesh);

    const ghostRingGeo = new THREE.RingGeometry(
      BALL_RADIUS * 0.86,
      BALL_RADIUS * 1.02,
      40
    );
    ghostRingGeo.rotateX(-Math.PI / 2);
    this.disposables.push(ghostRingGeo);
    this.ghostRingMat = new THREE.MeshBasicMaterial({
      color: 0xf8f0dc,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ghostRingMesh = new THREE.Mesh(ghostRingGeo, this.ghostRingMat);
    this.aimGroup.add(this.ghostRingMesh);

    const ghostFillGeo = new THREE.CircleGeometry(BALL_RADIUS * 0.86, 32);
    ghostFillGeo.rotateX(-Math.PI / 2);
    this.disposables.push(ghostFillGeo);
    this.ghostFillMat = new THREE.MeshBasicMaterial({
      color: 0xf8f0dc,
      transparent: true,
      opacity: 0.14,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.ghostFillMesh = new THREE.Mesh(ghostFillGeo, this.ghostFillMat);
    this.aimGroup.add(this.ghostFillMesh);

    this.targetRayMat = new THREE.MeshBasicMaterial({
      color: 0x6ee7b7,
      transparent: true,
      opacity: 0.94,
      depthWrite: false,
    });
    this.targetRayMesh = new THREE.Mesh(rayGeo, this.targetRayMat);
    this.aimGroup.add(this.targetRayMesh);

    this.postRayMat = new THREE.MeshBasicMaterial({
      color: 0xe9c46a,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    this.postRayMesh = new THREE.Mesh(rayGeo, this.postRayMat);
    this.aimGroup.add(this.postRayMesh);

    // Invalid target 'X' mark on ghost ball
    this.invalidXGroup = new THREE.Group();
    const xBarGeo = new THREE.PlaneGeometry(BALL_RADIUS * 1.2, 0.0048);
    xBarGeo.rotateX(-Math.PI / 2);
    const xMat = new THREE.MeshBasicMaterial({
      color: 0xf87171,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    this.disposables.push(xBarGeo, xMat);
    const x1 = new THREE.Mesh(xBarGeo, xMat);
    x1.rotation.y = Math.PI / 4;
    const x2 = new THREE.Mesh(xBarGeo, xMat);
    x2.rotation.y = -Math.PI / 4;
    this.invalidXGroup.add(x1, x2);
    this.aimGroup.add(this.invalidXGroup);

    // Kitchen highlight for break/scratch placement
    const kitchenWidth = PLAY_HALF_LENGTH + HEAD_STRING_X;
    const kitchenGeo = new THREE.PlaneGeometry(kitchenWidth, PLAY_HALF_WIDTH * 2);
    kitchenGeo.rotateX(-Math.PI / 2);
    const kitchenMat = new THREE.MeshBasicMaterial({
      color: 0xe2b764,
      transparent: true,
      opacity: 0.09,
      depthWrite: false,
    });
    this.disposables.push(kitchenGeo, kitchenMat);
    this.kitchenOverlay = new THREE.Mesh(kitchenGeo, kitchenMat);
    this.kitchenOverlay.position.set(
      -PLAY_HALF_LENGTH + kitchenWidth * 0.5,
      0.0018,
      0
    );
    this.kitchenOverlay.visible = false;
    this.scene.add(this.kitchenOverlay);

    // Ball-in-hand cue halo ring
    const placeGeo = new THREE.RingGeometry(
      BALL_RADIUS * 1.2,
      BALL_RADIUS * 1.48,
      36
    );
    placeGeo.rotateX(-Math.PI / 2);
    this.cuePlacementRingMat = new THREE.MeshBasicMaterial({
      color: 0xe6b85c,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.disposables.push(placeGeo, this.cuePlacementRingMat);
    this.cuePlacementRing = new THREE.Mesh(placeGeo, this.cuePlacementRingMat);
    this.cuePlacementRing.visible = false;
    this.scene.add(this.cuePlacementRing);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
  }

  getDomElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  setCameraPreset(preset: CameraPreset): void {
    this.cameraPreset = preset;
    const w = Math.max(this.container.clientWidth, 320);
    const h = Math.max(this.container.clientHeight, 240);
    this.applyCameraPreset(preset, w / h);
  }

  private applyCameraPreset(preset: CameraPreset, aspect: number): void {
    const safeAspect = Math.max(aspect, 0.75);
    const fovDeg = preset === 'top' ? 23 : preset === 'angled' ? 27 : 25;
    this.camera.fov = fovDeg;
    const halfFovTan = Math.tan(THREE.MathUtils.degToRad(fovDeg * 0.5));

    // Tilt angle from vertical: gives rich 2.5D depth on wood cabinet, rails & pockets
    const tiltRad =
      preset === 'top'
        ? 0
        : preset === 'angled'
          ? THREE.MathUtils.degToRad(29)
          : THREE.MathUtils.degToRad(17);

    // Ensure full outer cabinet + cue margin fits with zero HUD/edge clipping
    const needHalfW = 1.42;
    const needHalfH = 0.78 * Math.cos(tiltRad) + 0.07;

    const distForH = needHalfH / halfFovTan;
    const distForW = needHalfW / (halfFovTan * safeAspect);
    const dist = Math.max(distForH, distForW);

    if (preset === 'top') {
      // Exact 90° top-down view: up = -Z keeps left/right/top/bottom orientation identical to 2.5D views
      this.camera.up.set(0, 0, -1);
      this.camera.position.set(0, dist, 0);
      this.camera.lookAt(0, 0, 0);
    } else {
      const camY = dist * Math.cos(tiltRad);
      const camZ = dist * Math.sin(tiltRad);
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(0, camY, camZ);
      this.camera.lookAt(
        0,
        preset === 'angled' ? -0.02 : -0.005,
        preset === 'angled' ? 0.02 : 0.01
      );
    }

    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  private handleResize(): void {
    if (this.disposed) return;
    const w = Math.max(this.container.clientWidth, 320);
    const h = Math.max(this.container.clientHeight, 240);
    this.renderer.setSize(w, h);
    this.applyCameraPreset(this.cameraPreset, w / h);
  }

  private setupLighting(): void {
    const addLightsTo = (targetScene: THREE.Scene, withShadows: boolean) => {
      const hemi = new THREE.HemisphereLight(0xffebd0, 0x26140a, 1.05);
      targetScene.add(hemi);

      // Warm billiard pendant key directional light for soft shadow casting
      const mainLight = new THREE.DirectionalLight(0xfff1d6, 1.58);
      mainLight.position.set(0.32, 3.2, 0.42);
      if (withShadows) {
        mainLight.castShadow = true;
        mainLight.shadow.mapSize.set(1024, 1024);
        mainLight.shadow.camera.near = 1.0;
        mainLight.shadow.camera.far = 6.5;
        mainLight.shadow.camera.left = -2.2;
        mainLight.shadow.camera.right = 2.2;
        mainLight.shadow.camera.top = 1.4;
        mainLight.shadow.camera.bottom = -1.4;
        mainLight.shadow.bias = -0.0005;
      }
      targetScene.add(mainLight);

      const fillLight = new THREE.PointLight(0xffdfb0, 0.72, 7.2);
      fillLight.position.set(-0.72, 1.45, -0.55);
      targetScene.add(fillLight);

      const rimLight = new THREE.PointLight(0xf6c77c, 0.58, 7.2);
      rimLight.position.set(0.82, 1.38, 0.35);
      targetScene.add(rimLight);
    };

    addLightsTo(this.scene, true);
    addLightsTo(this.cueScene, false);
  }

  private buildRoomFloor(): void {
    const floorTex = createFloorPlankTexture();
    const floorGeo = new THREE.PlaneGeometry(7.5, 5.2);
    floorGeo.rotateX(-Math.PI / 2);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.84,
      metalness: 0.04,
      color: 0x9b795e,
    });
    this.disposables.push(floorTex, floorGeo, floorMat);

    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, -0.62, 0);
    floorMesh.receiveShadow = true;
    this.scene.add(floorMesh);
  }

  private buildTable(): void {
    const HL = PLAY_HALF_LENGTH;
    const HW = PLAY_HALF_WIDTH;
    const { map: feltMap, bumpMap: feltBump } = createFeltTextures();
    const {
      mapH: woodMapH,
      mapV: woodMapV,
      bumpMapH: woodBumpH,
      bumpMapV: woodBumpV,
    } = createWoodTextures();
    this.disposables.push(
      feltMap,
      feltBump,
      woodMapH,
      woodMapV,
      woodBumpH,
      woodBumpV
    );

    // 1. Slate playing surface
    const slateW = HL * 2 + 0.16;
    const slateD = HW * 2 + 0.16;
    const slateGeo = new THREE.BoxGeometry(slateW, 0.04, slateD);
    const feltMat = new THREE.MeshStandardMaterial({
      map: feltMap,
      bumpMap: feltBump,
      bumpScale: 0.0018,
      roughness: 0.9,
      metalness: 0.02,
    });
    this.disposables.push(slateGeo, feltMat);
    const slateMesh = new THREE.Mesh(slateGeo, feltMat);
    slateMesh.position.set(0, -0.02, 0);
    slateMesh.receiveShadow = true;
    this.scene.add(slateMesh);

    // 2. Handcrafted beveled aged-walnut rails & carved lower cabinet
    const woodMatH = new THREE.MeshStandardMaterial({
      map: woodMapH,
      bumpMap: woodBumpH,
      bumpScale: 0.0014,
      roughness: 0.42,
      metalness: 0.05,
    });
    const woodMatV = new THREE.MeshStandardMaterial({
      map: woodMapV,
      bumpMap: woodBumpV,
      bumpScale: 0.0014,
      roughness: 0.42,
      metalness: 0.05,
    });

    const railDepth = 0.046;
    const railThick = 0.112;
    const railH = 0.068;
    const railBottomY = -0.02;
    const railInnerX = HL + railDepth;
    const railOuterX = railInnerX + railThick;
    const railInnerZ = HW + railDepth;
    const railOuterZ = railInnerZ + railThick;

    this.disposables.push(woodMatH, woodMatV);

    // Recessed lower mahogany apron + solid corner posts
    const apronGeo = new THREE.BoxGeometry(
      railOuterX * 2 - 0.07,
      0.11,
      railOuterZ * 2 - 0.07
    );
    const apronMat = new THREE.MeshStandardMaterial({
      color: 0x221008,
      roughness: 0.56,
      metalness: 0.08,
    });
    const brassTrimMat = new THREE.MeshStandardMaterial({
      color: 0xc2923c,
      roughness: 0.32,
      metalness: 0.44,
    });
    const legGeo = new THREE.BoxGeometry(0.11, 0.54, 0.11);
    const legTrimGeo = new THREE.BoxGeometry(
      railOuterX * 2 - 0.05,
      0.012,
      railOuterZ * 2 - 0.05
    );
    this.disposables.push(apronGeo, apronMat, brassTrimMat, legGeo, legTrimGeo);

    const apron = new THREE.Mesh(apronGeo, apronMat);
    apron.position.set(0, -0.075, 0);
    this.scene.add(apron);

    const apronTrim = new THREE.Mesh(legTrimGeo, brassTrimMat);
    apronTrim.position.set(0, -0.025, 0);
    this.scene.add(apronTrim);

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(legGeo, apronMat);
        leg.position.set(sx * (railOuterX - 0.11), -0.35, sz * (railOuterZ - 0.11));
        this.scene.add(leg);
      }
    }

    // Long rails (top & bottom) carved cleanly around the side pocket arch
    const railEndSpanX = HL - 0.022;
    const sidePocketZ = HW + 0.038;
    const sideCutRadius = 0.056;
    const railBevel = 0.004;
    const effInnerZ = railInnerZ + railBevel;

    for (const sz of [-1, 1]) {
      const innerZ = sz * effInnerZ;
      const outerZ = sz * (railOuterZ - railBevel);
      const pCenterY = -sz * sidePocketZ;

      const s = new THREE.Shape();
      const archDx = Math.sqrt(
        Math.max(0, sideCutRadius * sideCutRadius - Math.pow(effInnerZ - sidePocketZ, 2))
      );
      if (sz === -1) {
        // Top rail (worldZ <= -railInnerZ => shapeY >= railInnerZ)
        s.moveTo(-railEndSpanX, innerZ * -1);
        s.lineTo(-archDx, innerZ * -1);
        const startA = Math.atan2(effInnerZ - sidePocketZ, -archDx);
        const endA = Math.atan2(effInnerZ - sidePocketZ, archDx);
        s.absarc(0, pCenterY, sideCutRadius, startA, endA, true);
        s.lineTo(railEndSpanX, innerZ * -1);
        s.lineTo(railEndSpanX, outerZ * -1);
        s.lineTo(-railEndSpanX, outerZ * -1);
      } else {
        // Bottom rail (worldZ >= railInnerZ => shapeY <= -railInnerZ)
        s.moveTo(-railEndSpanX, outerZ * -1);
        s.lineTo(railEndSpanX, outerZ * -1);
        s.lineTo(railEndSpanX, innerZ * -1);
        s.lineTo(archDx, innerZ * -1);
        const startA = Math.atan2(-effInnerZ + sidePocketZ, archDx);
        const endA = Math.atan2(-effInnerZ + sidePocketZ, -archDx);
        s.absarc(0, pCenterY, sideCutRadius, startA, endA, true);
        s.lineTo(-railEndSpanX, innerZ * -1);
      }
      s.closePath();

      const geo = extrudeXZ(s, railH, railBevel, railBevel, 2);
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, woodMatH);
      mesh.position.y = railBottomY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // Short rails (left & right) with lengthwise vertical wood grain
    const railEndSpanZ = HW - 0.022;
    for (const sx of [-1, 1]) {
      const innerX = sx * (railInnerX + railBevel);
      const outerX = sx * (railOuterX - railBevel);
      const minX = Math.min(innerX, outerX);
      const maxX = Math.max(innerX, outerX);
      const shape = shapeFromXZ([
        [minX, -railEndSpanZ],
        [maxX, -railEndSpanZ],
        [maxX, railEndSpanZ],
        [minX, railEndSpanZ],
      ]);
      const geo = extrudeXZ(shape, railH, railBevel, railBevel, 2);
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, woodMatV);
      mesh.position.y = railBottomY;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    }

    // 3. Sculpted antique-brass corner & side pocket castings with dome rivets
    const rivetGeo = new THREE.SphereGeometry(0.0042, 12, 8);
    rivetGeo.scale(1, 0.55, 1);
    const rivetMat = new THREE.MeshStandardMaterial({
      color: 0xd1a44b,
      roughness: 0.28,
      metalness: 0.86,
    });
    this.disposables.push(rivetGeo, rivetMat);

    const cornerPocketX = HL + 0.03;
    const cornerPocketZ = HW + 0.03;
    const cornerPlateH = railH + 0.002;
    const cornerBevel = 0.0035;

    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        // Canonical (+1, +1) bottom-right corner plate in local shape coords, then mirrored via scale(sx, 1, sz)
        const cShape = new THREE.Shape();
        const cx = cornerPocketX;
        const cz = -cornerPocketZ;
        const localXEnd = HL - 0.026;
        const localZEnd = -(HW - 0.026);
        const localXOut = railOuterX - cornerBevel + 0.001;
        const localZOut = -(railOuterZ - cornerBevel + 0.001);
        const localXIn = railInnerX + cornerBevel;
        const localZIn = -(railInnerZ + cornerBevel);
        const rInner = Math.hypot(localXIn - cx, localZEnd - cz);

        const angLeft = Math.atan2(localZIn - cz, localXEnd - cx);
        const angBottom = Math.atan2(localZEnd - cz, localXIn - cx);

        cShape.moveTo(localXEnd, localZOut);
        cShape.lineTo(localXOut - 0.026, localZOut);
        cShape.quadraticCurveTo(localXOut, localZOut, localXOut, localZOut + 0.026);
        cShape.lineTo(localXOut, localZEnd);
        cShape.lineTo(localXIn, localZEnd);
        cShape.absarc(cx, cz, rInner, angBottom, angLeft, true);
        cShape.lineTo(localXEnd, localZIn);
        cShape.closePath();

        const plateGeo = extrudeXZ(cShape, cornerPlateH, cornerBevel, cornerBevel, 2);
        plateGeo.scale(sx, 1, sz);
        // Negative scale flips triangle winding; recompute normals and use DoubleSide on corner castings
        if (sx * sz < 0) {
          const idx = plateGeo.getIndex();
          if (idx) {
            const arr = idx.array as Uint16Array | Uint32Array;
            for (let i = 0; i < arr.length; i += 3) {
              const tmp = arr[i + 1];
              arr[i + 1] = arr[i + 2];
              arr[i + 2] = tmp;
            }
          } else {
            const pos = plateGeo.getAttribute('position');
            const norm = plateGeo.getAttribute('normal');
            for (let i = 0; i < pos.count; i += 3) {
              for (const attr of [pos, norm]) {
                if (!attr) continue;
                for (let c = 0; c < 3; c++) {
                  const t = attr.getComponent(i + 1, c);
                  attr.setComponent(i + 1, c, attr.getComponent(i + 2, c));
                  attr.setComponent(i + 2, c, t);
                }
              }
            }
          }
        }
        this.disposables.push(plateGeo);

        const plate = new THREE.Mesh(plateGeo, brassTrimMat);
        plate.position.y = railBottomY;
        plate.castShadow = true;
        plate.receiveShadow = true;
        this.scene.add(plate);

        // Corner brass dome rivets
        const topY = railBottomY + cornerPlateH + 0.0012;
        for (const [rx, rz] of [
          [HL + 0.015, HW + 0.125],
          [HL + 0.125, HW + 0.015],
          [HL + 0.122, HW + 0.122],
        ] as const) {
          const rivet = new THREE.Mesh(rivetGeo, rivetMat);
          rivet.position.set(sx * rx, topY, sz * rz);
          this.scene.add(rivet);
        }
      }
    }

    // Extruded beveled antique-brass side pocket saddle plates + rivets (mirrors corner castings)
    const sideInR = 0.055;
    const sideOutR = 0.080;
    const sideDy = effInnerZ - sidePocketZ;
    const sideDxIn = Math.sqrt(Math.max(0, sideInR * sideInR - sideDy * sideDy));
    const sideDxOut = Math.sqrt(Math.max(0, sideOutR * sideOutR - sideDy * sideDy));
    const sideShape = new THREE.Shape();
    const inStartA = Math.atan2(sideDy, -sideDxIn);
    const inEndA = Math.atan2(sideDy, sideDxIn);
    const outStartA = Math.atan2(sideDy, sideDxOut);
    const outEndA = Math.atan2(sideDy, -sideDxOut);
    sideShape.moveTo(-sideDxOut, effInnerZ);
    sideShape.lineTo(-sideDxIn, effInnerZ);
    sideShape.absarc(0, sidePocketZ, sideInR, inStartA, inEndA, true);
    sideShape.lineTo(sideDxOut, effInnerZ);
    sideShape.absarc(0, sidePocketZ, sideOutR, outStartA, outEndA, false);
    sideShape.closePath();

    const sidePlateGeo = extrudeXZ(sideShape, cornerPlateH, cornerBevel, cornerBevel, 2);
    this.disposables.push(sidePlateGeo);

    for (const sz of [-1, 1]) {
      const sp = new THREE.Mesh(sidePlateGeo, brassTrimMat);
      sp.position.y = railBottomY;
      // Shape sits at +sidePocketZ (which extrudeXZ rotates to worldZ < 0); rotating PI mirrors cleanly to worldZ > 0
      sp.rotation.y = sz === -1 ? 0 : Math.PI;
      sp.castShadow = true;
      sp.receiveShadow = true;
      this.scene.add(sp);

      for (const rx of [-0.067, 0.067]) {
        const rivet = new THREE.Mesh(rivetGeo, rivetMat);
        rivet.position.set(rx, railBottomY + cornerPlateH + 0.0012, sz * (sidePocketZ + 0.01));
        this.scene.add(rivet);
      }
    }

    // 4. Inlaid warm bone/ivory diamond sights with subtle brass bezel
    const sightGeo = new THREE.OctahedronGeometry(0.0062, 0);
    sightGeo.scale(1.15, 0.24, 0.78);
    const sightMat = new THREE.MeshStandardMaterial({
      color: 0xefe1be,
      roughness: 0.28,
      metalness: 0.22,
    });
    this.disposables.push(sightGeo, sightMat);

    const railTopY = railBottomY + railH;
    for (const frac of [-0.75, -0.5, -0.25, 0.25, 0.5, 0.75]) {
      for (const sz of [-1, 1]) {
        const diamond = new THREE.Mesh(sightGeo, sightMat);
        diamond.position.set(
          frac * HL,
          railTopY + 0.0005,
          sz * (HW + railDepth + railThick * 0.48)
        );
        this.scene.add(diamond);
      }
    }
    for (const frac of [-0.5, 0, 0.5]) {
      for (const sx of [-1, 1]) {
        const diamond = new THREE.Mesh(sightGeo, sightMat);
        diamond.rotation.y = Math.PI / 2;
        diamond.position.set(
          sx * (HL + railDepth + railThick * 0.48),
          railTopY + 0.0005,
          frac * HW
        );
        this.scene.add(diamond);
      }
    }

    // 5. Seamless mitered & beveled baize cushion rails matching exact physics CUSHION_SEGMENTS
    const cushionMat = new THREE.MeshStandardMaterial({
      color: 0x104c34,
      roughness: 0.78,
      metalness: 0.02,
    });
    const cushionH = BALL_RADIUS * 1.42;
    const cushionBevel = 0.0024;
    this.disposables.push(cushionMat);

    // Along-jaw offsets back to rail inner boundary (railDepth + 0.004)
    const jawZ = 0.050;
    const sideJawX = SIDE_OPEN - (SIDE_OPEN - 1.65 * BALL_RADIUS) * (jawZ / 0.072);
    const cornerJawX =
      HL - CORNER_OPEN + (CORNER_OPEN - 0.008) * (jawZ / 0.068);

    const addCushionPolygon = (pts: ReadonlyArray<readonly [number, number]>) => {
      const shape = shapeFromXZ(pts);
      const geo = extrudeXZ(shape, cushionH, cushionBevel, cushionBevel, 2);
      this.disposables.push(geo);
      const mesh = new THREE.Mesh(geo, cushionMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
    };

    // Top-Left & Top-Right cushions (z <= -HW)
    addCushionPolygon([
      [-HL + CORNER_OPEN - 0.001, -HW - cushionBevel],
      [-SIDE_OPEN + 0.001, -HW - cushionBevel],
      [-sideJawX - cushionBevel, -HW - jawZ],
      [-cornerJawX + cushionBevel, -HW - jawZ],
    ]);
    addCushionPolygon([
      [SIDE_OPEN - 0.001, -HW - cushionBevel],
      [HL - CORNER_OPEN + 0.001, -HW - cushionBevel],
      [cornerJawX - cushionBevel, -HW - jawZ],
      [sideJawX + cushionBevel, -HW - jawZ],
    ]);

    // Bottom-Left & Bottom-Right cushions (z >= HW)
    addCushionPolygon([
      [-HL + CORNER_OPEN - 0.001, HW + cushionBevel],
      [-cornerJawX + cushionBevel, HW + jawZ],
      [-sideJawX - cushionBevel, HW + jawZ],
      [-SIDE_OPEN + 0.001, HW + cushionBevel],
    ]);
    addCushionPolygon([
      [SIDE_OPEN - 0.001, HW + cushionBevel],
      [sideJawX + cushionBevel, HW + jawZ],
      [cornerJawX - cushionBevel, HW + jawZ],
      [HL - CORNER_OPEN + 0.001, HW + cushionBevel],
    ]);

    // Left & Right short cushions
    const endJawZ =
      HW - CORNER_OPEN + (CORNER_OPEN - 0.008) * (jawZ / 0.068);
    addCushionPolygon([
      [-HL - cushionBevel, -HW + CORNER_OPEN - 0.001],
      [-HL - jawZ, -endJawZ + cushionBevel],
      [-HL - jawZ, endJawZ - cushionBevel],
      [-HL - cushionBevel, HW - CORNER_OPEN + 0.001],
    ]);
    addCushionPolygon([
      [HL + cushionBevel, -HW + CORNER_OPEN - 0.001],
      [HL + cushionBevel, HW - CORNER_OPEN + 0.001],
      [HL + jawZ, endJawZ - cushionBevel],
      [HL + jawZ, -endJawZ + cushionBevel],
    ]);

    // Ensure jaw facings (unused reference guard) stay aligned with physics constants
    void CUSHION_SEGMENTS;

    // 6. Stitched dark saddle-leather drop pockets & protective leather hoods
    const pocketWellMat = new THREE.MeshBasicMaterial({ color: 0x040201 });
    const pocketLeatherMat = new THREE.MeshStandardMaterial({
      color: 0x2d170c,
      roughness: 0.62,
      metalness: 0.08,
    });
    const pocketHoodMat = new THREE.MeshStandardMaterial({
      color: 0x3b1f10,
      roughness: 0.56,
      metalness: 0.1,
    });
    this.disposables.push(pocketWellMat, pocketLeatherMat, pocketHoodMat);

    for (const p of POCKETS) {
      const wellGeo = new THREE.CylinderGeometry(
        p.dropRadius * 1.13,
        p.dropRadius * 0.94,
        0.024,
        32
      );
      const rimGeo = new THREE.TorusGeometry(p.dropRadius * 1.14, 0.0085, 10, 32);
      const hoodGeo = new THREE.TorusGeometry(
        p.dropRadius * 1.18,
        0.0075,
        10,
        24,
        Math.PI * 1.1
      );
      rimGeo.rotateX(Math.PI / 2);
      hoodGeo.rotateX(Math.PI / 2);
      this.disposables.push(wellGeo, rimGeo, hoodGeo);

      const well = new THREE.Mesh(wellGeo, pocketWellMat);
      well.position.set(p.x, -0.008, p.z);
      this.scene.add(well);

      const rim = new THREE.Mesh(rimGeo, pocketLeatherMat);
      rim.position.set(p.x, 0.006, p.z);
      this.scene.add(rim);

      // Raised curved saddle-leather hood on the outer lip of the pocket
      const hood = new THREE.Mesh(hoodGeo, pocketHoodMat);
      hood.position.set(p.x, 0.015, p.z);
      const outAngle = Math.atan2(p.z, p.x);
      hood.rotation.y = -outAngle - Math.PI * 0.55;
      hood.castShadow = true;
      this.scene.add(hood);
    }
  }

  private buildBalls(): void {
    const sphereGeo = new THREE.SphereGeometry(BALL_RADIUS, 40, 28);
    const shadowTex = createShadowTexture();
    const shadowGeo = new THREE.PlaneGeometry(
      BALL_RADIUS * 2.55,
      BALL_RADIUS * 2.55
    );
    shadowGeo.rotateX(-Math.PI / 2);
    this.disposables.push(sphereGeo, shadowTex, shadowGeo);

    for (let id = 0; id <= 15; id++) {
      const tex = createBallTexture(id);
      const mat = new THREE.MeshPhysicalMaterial({
        map: tex,
        roughness: 0.14,
        metalness: 0.02,
        clearcoat: 0.94,
        clearcoatRoughness: 0.08,
      });
      this.disposables.push(tex, mat);

      const mesh = new THREE.Mesh(sphereGeo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.position.set(0, BALL_RADIUS, 0);
      this.scene.add(mesh);
      this.ballMeshes.push(mesh);

      const shadowMat = new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
      });
      this.disposables.push(shadowMat);
      const shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.position.set(0, 0.0008, 0);
      this.scene.add(shadow);
      this.ballShadows.push(shadow);

      // Rotate initial orientation so medallions & stripe bands face up toward the 2.5D camera
      const tiltYaw = id === 0 ? 0.25 : ((id * 0.37) % 0.5) - 0.25;
      const q = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(-Math.PI * 0.36, tiltYaw, 0)
      );
      mesh.quaternion.copy(q);
      this.ballQuats.push(q);
    }
  }

  private buildCueStick(): {
    pivot: THREE.Group;
    group: THREE.Group;
    shadowPivot: THREE.Group;
    shadowGroup: THREE.Group;
  } {
    const pivot = new THREE.Group();
    const group = new THREE.Group();
    // Slight ~4.1° cue butt elevation
    group.rotation.z = -0.072;

    const tipTex = createChalkTipTexture();
    const shaftTex = createCueShaftTexture();
    const buttTex = createCueButtTexture();

    const tipMat = new THREE.MeshStandardMaterial({
      map: tipTex,
      roughness: 0.84,
      metalness: 0.02,
    });
    const ferruleMat = new THREE.MeshStandardMaterial({
      color: 0xefe4cb,
      roughness: 0.26,
    });
    const shaftMat = new THREE.MeshStandardMaterial({
      map: shaftTex,
      roughness: 0.36,
      metalness: 0.03,
    });
    const jointMat = new THREE.MeshStandardMaterial({
      color: 0xb98b39,
      roughness: 0.32,
      metalness: 0.82,
    });
    const buttMat = new THREE.MeshStandardMaterial({
      map: buttTex,
      roughness: 0.32,
      metalness: 0.05,
    });
    const bumperMat = new THREE.MeshStandardMaterial({
      color: 0x1a100b,
      roughness: 0.72,
    });

    const parts: Array<{
      len: number;
      rFront: number;
      rBack: number;
      mat: THREE.Material;
    }> = [
      { len: 0.008, rFront: 0.0061, rBack: 0.0062, mat: tipMat },
      { len: 0.022, rFront: 0.0062, rBack: 0.0066, mat: ferruleMat },
      { len: 0.70, rFront: 0.0066, rBack: 0.0111, mat: shaftMat },
      { len: 0.022, rFront: 0.0111, rBack: 0.0115, mat: jointMat },
      { len: 0.65, rFront: 0.0115, rBack: 0.0154, mat: buttMat },
      { len: 0.024, rFront: 0.0154, rBack: 0.0146, mat: bumperMat },
    ];
    this.disposables.push(
      tipTex,
      shaftTex,
      buttTex,
      tipMat,
      ferruleMat,
      shaftMat,
      jointMat,
      buttMat,
      bumperMat
    );

    let cursorX = 0;
    for (const p of parts) {
      const geo = new THREE.CylinderGeometry(p.rFront, p.rBack, p.len, 20);
      geo.rotateZ(-Math.PI / 2);
      this.disposables.push(geo);
      const m = new THREE.Mesh(geo, p.mat);
      m.position.set(cursorX - p.len * 0.5, 0, 0);
      group.add(m);
      cursorX -= p.len;
    }

    pivot.add(group);

    // Lightweight invisible shadow-caster proxy in main scene so cue still casts a realistic shadow onto the felt
    const shadowPivot = new THREE.Group();
    const shadowGroup = new THREE.Group();
    shadowGroup.rotation.z = group.rotation.z;
    const totalLen = Math.abs(cursorX);
    const shadowGeo = new THREE.CylinderGeometry(0.0062, 0.0154, totalLen, 10);
    shadowGeo.rotateZ(-Math.PI / 2);
    const shadowMat = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: false,
    });
    this.disposables.push(shadowGeo, shadowMat);
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.position.set(-totalLen * 0.5, 0, 0);
    shadowMesh.castShadow = true;
    shadowGroup.add(shadowMesh);
    shadowPivot.add(shadowGroup);

    return { pivot, group, shadowPivot, shadowGroup };
  }

  syncBallsImmediate(balls: readonly BallState[]): void {
    for (let i = 0; i < balls.length; i++) {
      const b = balls[i];
      const mesh = this.ballMeshes[b.id];
      const shadow = this.ballShadows[b.id];
      if (!mesh || !shadow) continue;

      if (b.pocketed) {
        if (!this.dropAnims.has(b.id)) {
          mesh.visible = false;
          shadow.visible = false;
        }
      } else {
        this.dropAnims.delete(b.id);
        mesh.visible = true;
        shadow.visible = true;
        mesh.position.set(b.x, BALL_RADIUS, b.z);
        shadow.position.set(b.x, 0.0008, b.z);
      }
    }
  }

  applyTimelinePoses(poses: readonly InterpolatedBallPose[], dt: number): void {
    for (let i = 0; i < poses.length; i++) {
      const p = poses[i];
      const mesh = this.ballMeshes[p.id];
      const shadow = this.ballShadows[p.id];
      if (!mesh || !shadow) continue;

      if (p.pocketed) {
        if (!this.dropAnims.has(p.id) && mesh.visible) {
          this.triggerPocketDrop(p.id, p.x, p.z);
        }
        continue;
      }

      mesh.visible = true;
      shadow.visible = true;
      mesh.position.set(p.x, BALL_RADIUS, p.z);
      shadow.position.set(p.x, 0.0008, p.z);

      const wMag = Math.hypot(p.wx, p.wy, p.wz);
      if (wMag > 1e-4 && dt > 0) {
        // Clamp per-frame angle (~25.8 deg max) to prevent wagon-wheel aliasing
        const stepAngle = Math.min(wMag * dt, 0.45);
        this.tmpAxis.set(p.wx / wMag, p.wy / wMag, p.wz / wMag);
        this.tmpQuat.setFromAxisAngle(this.tmpAxis, stepAngle);
        this.ballQuats[p.id].premultiply(this.tmpQuat).normalize();
        mesh.quaternion.copy(this.ballQuats[p.id]);
      }
    }
  }

  triggerPocketDrop(ballId: number, pocketX: number, pocketZ: number): void {
    const mesh = this.ballMeshes[ballId];
    if (!mesh) return;
    this.dropAnims.set(ballId, {
      ballId,
      startX: mesh.position.x,
      startZ: mesh.position.z,
      pocketX,
      pocketZ,
      elapsed: 0,
    });
  }

  triggerStrikeAnimation(startPower: number, onImpact: () => void): void {
    this.strikeAnim = {
      active: true,
      elapsed: 0,
      duration: 0.075,
      startPull: 0.03 + startPower * 0.36,
      onImpact,
    };
  }

  setAimState(state: AimVisualState): void {
    this.kitchenOverlay.visible = state.showKitchen;

    if (state.ballInHandMode) {
      this.cuePlacementRing.visible = true;
      this.cuePlacementRing.position.set(state.cueX, 0.003, state.cueZ);
      this.cuePlacementRingMat.color.setHex(
        state.ballInHandValid ? 0xe6b85c : 0xef4444
      );
    } else {
      this.cuePlacementRing.visible = false;
    }

    if (!state.visible) {
      if (!this.strikeAnim.active) {
        this.cuePivot.visible = false;
        this.cueShadowPivot.visible = false;
      }
      this.aimGroup.visible = false;
      return;
    }

    // Position 3D cue stick & shadow proxy with contact offset (tipX, tipY)
    this.cuePivot.visible = true;
    this.cueShadowPivot.visible = true;
    this.cuePivot.position.set(state.cueX, BALL_RADIUS, state.cueZ);
    this.cuePivot.rotation.y = -state.angle;
    this.cueShadowPivot.position.copy(this.cuePivot.position);
    this.cueShadowPivot.rotation.y = this.cuePivot.rotation.y;

    const pullOffset = this.strikeAnim.active
      ? this.strikeAnim.startPull *
        (1 - Math.min(1, this.strikeAnim.elapsed / this.strikeAnim.duration))
      : 0.025 + state.power * 0.36;

    const contactOffsetY = state.tipY * BALL_RADIUS * 0.85;
    const contactOffsetZ = state.tipX * BALL_RADIUS * 0.85;
    this.cueGroup.position.set(
      -(BALL_RADIUS + pullOffset),
      contactOffsetY,
      contactOffsetZ
    );
    this.cueShadowGroup.position.copy(this.cueGroup.position);

    // Position aiming guides on equatorial plane (y = BALL_RADIUS) to eliminate 2.5D parallax
    const guide = state.guide;
    if (!guide) {
      this.aimGroup.visible = false;
      return;
    }
    this.aimGroup.visible = true;

    const lineY = BALL_RADIUS;
    this.placeRibbon(
      this.cueRayMesh,
      guide.cueStart.x,
      guide.cueStart.z,
      guide.ghostPos.x,
      guide.ghostPos.z,
      lineY
    );
    this.cueRayMat.color.setHex(guide.isLegalTarget ? 0xf4ead2 : 0xfca5a5);

    this.ghostRingMesh.position.set(guide.ghostPos.x, lineY, guide.ghostPos.z);
    this.ghostFillMesh.position.set(guide.ghostPos.x, lineY, guide.ghostPos.z);

    if (guide.hitType === 'ball' && !guide.isLegalTarget) {
      this.ghostRingMat.color.setHex(0xf87171);
      this.ghostFillMat.color.setHex(0xef4444);
      this.invalidXGroup.visible = true;
      this.invalidXGroup.position.set(
        guide.ghostPos.x,
        lineY + 0.001,
        guide.ghostPos.z
      );
    } else {
      this.ghostRingMat.color.setHex(0xf8f0dc);
      this.ghostFillMat.color.setHex(0xf8f0dc);
      this.invalidXGroup.visible = false;
    }

    if (guide.targetStart && guide.targetEnd) {
      this.targetRayMesh.visible = true;
      this.placeRibbon(
        this.targetRayMesh,
        guide.targetStart.x,
        guide.targetStart.z,
        guide.targetEnd.x,
        guide.targetEnd.z,
        lineY
      );
      this.targetRayMat.color.setHex(guide.isLegalTarget ? 0x6ee7b7 : 0xf87171);
    } else {
      this.targetRayMesh.visible = false;
    }

    if (guide.cuePostEnd) {
      this.postRayMesh.visible = true;
      this.placeRibbon(
        this.postRayMesh,
        guide.ghostPos.x,
        guide.ghostPos.z,
        guide.cuePostEnd.x,
        guide.cuePostEnd.z,
        lineY
      );
    } else {
      this.postRayMesh.visible = false;
    }
  }

  private placeRibbon(
    mesh: THREE.Mesh,
    x1: number,
    z1: number,
    x2: number,
    z2: number,
    y: number
  ): void {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set((x1 + x2) * 0.5, y, (z1 + z2) * 0.5);
    mesh.scale.set(len, 1, 1);
    mesh.rotation.y = -Math.atan2(dz, dx);
  }

  renderFrame(dt: number): void {
    if (this.disposed) return;

    // Advance strike animation
    if (this.strikeAnim.active) {
      this.strikeAnim.elapsed += dt;
      const frac = Math.min(1, this.strikeAnim.elapsed / this.strikeAnim.duration);
      const pull = this.strikeAnim.startPull * (1 - frac);
      this.cueGroup.position.x = -(BALL_RADIUS + pull);
      this.cueShadowGroup.position.x = this.cueGroup.position.x;
      if (frac >= 1) {
        this.strikeAnim.active = false;
        this.cuePivot.visible = false;
        this.cueShadowPivot.visible = false;
        const cb = this.strikeAnim.onImpact;
        this.strikeAnim.onImpact = null;
        cb?.();
      }
    }

    // Advance pocket drop animations
    if (this.dropAnims.size > 0) {
      for (const [ballId, anim] of this.dropAnims.entries()) {
        anim.elapsed += dt;
        const u = Math.min(1, anim.elapsed / 0.22);
        const mesh = this.ballMeshes[ballId];
        const shadow = this.ballShadows[ballId];
        if (mesh && shadow) {
          const x = anim.startX + (anim.pocketX - anim.startX) * u;
          const z = anim.startZ + (anim.pocketZ - anim.startZ) * u;
          const y = BALL_RADIUS * (1 - u * 2.8);
          mesh.position.set(x, y, z);
          mesh.scale.setScalar(1 - u * 0.3);
          shadow.visible = false;
          if (u >= 1) {
            mesh.visible = false;
            mesh.scale.setScalar(1);
            this.dropAnims.delete(ballId);
          }
        }
      }
    }

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.cuePivot.visible) {
      // Clear depth buffer before drawing cue stick so it always renders cleanly above balls and rails
      this.renderer.clearDepth();
      this.renderer.render(this.cueScene, this.camera);
    }
  }

  screenToTable(clientX: number, clientY: number): { x: number; z: number } | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.tmpVec2.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.tmpVec2.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.tmpVec2, this.camera);
    const hit = this.raycaster.ray.intersectPlane(
      this.ballCenterPlane,
      this.tmpVec3
    );
    if (!hit) return null;
    return { x: hit.x, z: hit.z };
  }

  tableToScreen(x: number, z: number): { x: number; y: number } {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.tmpVec3.set(x, BALL_RADIUS, z).project(this.camera);
    return {
      x: rect.left + (this.tmpVec3.x * 0.5 + 0.5) * rect.width,
      y: rect.top + (-this.tmpVec3.y * 0.5 + 0.5) * rect.height,
    };
  }

  dispose(): void {
    this.disposed = true;
    this.resizeObserver.disconnect();
    for (const d of this.disposables) {
      d.dispose();
    }
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
