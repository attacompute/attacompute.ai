import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { LiveSceneProps } from './LiveScene2D';

interface ProjectedLabel {
  id: string;
  text: string;
  sub?: string;
  x: number;
  y: number;
  visible: boolean;
}

interface NodeVisual {
  id: string;
  label: string;
  sub?: string;
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  baseScale: number;
}

interface ArcPacket {
  curve: THREE.QuadraticBezierCurve3;
  t: number;
  speed: number;
  color: THREE.Color;
  fromId: string;
  toId: string;
}

interface SceneProps3D extends LiveSceneProps {
  resetSignal: number;
  onContextLost: () => void;
}

export default function LiveScene3D({
  topology,
  profile,
  theme,
  selectedId,
  onSelect,
  reducedMotion,
  resetSignal,
  onContextLost,
}: SceneProps3D) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [labels, setLabels] = useState<ProjectedLabel[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(selectedId);
  const hoveredRef = useRef<string | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    if (resetSignal === 0) return;
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    const container = containerRef.current;
    if (cam && ctrl) {
      const w = container?.clientWidth || 640;
      const h = container?.clientHeight || 420;
      const aspect = w / h;
      const distScale = aspect < 1.2 ? Math.min(1.95, 1.32 / Math.max(aspect, 0.55)) : 1;
      cam.position.set(0, 5.2 * Math.min(1.35, distScale), 13.8 * distScale);
      ctrl.target.set(0, 0.15, 0);
      ctrl.update();
    }
  }, [resetSignal]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isDark = theme === 'dark';
    const palette = {
      bg: isDark ? 0x090b10 : 0xf4f7fb,
      grid: isDark ? 0x223047 : 0xcbd5e1,
      hubCore: isDark ? 0x22d3ee : 0x0284c7,
      hubRing: profile.live ? (isDark ? 0x34d399 : 0x059669) : isDark ? 0xfbbf24 : 0xd97706,
      buyer: isDark ? 0xfbbf24 : 0xd97706,
      direct: isDark ? 0x38bdf8 : 0x0369a1,
      peer: isDark ? 0x34d399 : 0x059669,
    };

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      onContextLost();
      return;
    }

    let dprCap = Math.min(window.devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dprCap);
    renderer.setSize(container.clientWidth || 640, container.clientHeight || 420);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isDark ? 1.15 : 1.02;

    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.innerHTML = '';
    container.appendChild(canvas);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      onContextLost();
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(palette.bg, isDark ? 0.028 : 0.022);

    const width = container.clientWidth || 640;
    const height = container.clientHeight || 420;
    const aspect = width / height;
    const distScale = aspect < 1.2 ? Math.min(1.95, 1.32 / Math.max(aspect, 0.55)) : 1;
    const camera = new THREE.PerspectiveCamera(42, aspect, 0.1, 100);
    camera.position.set(0, 5.2 * Math.min(1.35, distScale), 13.8 * distScale);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.enablePan = false;
    controls.minDistance = 6.5;
    controls.maxDistance = 30;
    controls.minPolarAngle = 0.28;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.target.set(0, 0.15, 0);
    controlsRef.current = controls;

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, isDark ? 0.85 : 1.25);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(isDark ? 0xa5f3fc : 0xffffff, isDark ? 1.4 : 1.2);
    keyLight.position.set(6, 12, 8);
    scene.add(keyLight);

    const rimLight = new THREE.PointLight(palette.hubCore, isDark ? 18 : 10, 26);
    rimLight.position.set(0, 2.5, 0);
    scene.add(rimLight);

    // Subtle architectural polar floor rings
    const floorGroup = new THREE.Group();
    floorGroup.position.y = -2.3;
    const ringMat = new THREE.LineBasicMaterial({
      color: palette.grid,
      transparent: true,
      opacity: isDark ? 0.45 : 0.55,
    });
    for (const r of [2.6, 5.2, 7.8]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
      }
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      floorGroup.add(new THREE.Line(geo, ringMat));
    }
    scene.add(floorGroup);

    // Build nodes
    const nodeVisuals: NodeVisual[] = [];
    const pickableMeshes: THREE.Mesh[] = [];
    const disposableGeos: THREE.BufferGeometry[] = [];
    const disposableMats: THREE.Material[] = [];

    // 1. Center Seller Hub
    const hubPos = new THREE.Vector3(0, 0.25, 0);
    const hubGeo = new THREE.IcosahedronGeometry(0.95, 1);
    const hubMat = new THREE.MeshStandardMaterial({
      color: palette.hubCore,
      emissive: palette.hubCore,
      emissiveIntensity: isDark ? 0.55 : 0.25,
      roughness: 0.22,
      metalness: 0.35,
      flatShading: true,
    });
    const hubMesh = new THREE.Mesh(hubGeo, hubMat);
    hubMesh.position.copy(hubPos);
    hubMesh.userData = { nodeId: 'hub' };
    scene.add(hubMesh);
    pickableMeshes.push(hubMesh);
    disposableGeos.push(hubGeo);
    disposableMats.push(hubMat);

    // Dual counter-rotating status rings around hub
    const outerRingGeo = new THREE.TorusGeometry(1.42, 0.035, 14, 72);
    const outerRingMat = new THREE.MeshBasicMaterial({
      color: palette.hubRing,
      transparent: true,
      opacity: 0.85,
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerRingMat);
    outerRing.position.copy(hubPos);
    outerRing.rotation.x = Math.PI * 0.44;
    scene.add(outerRing);

    const innerRingGeo = new THREE.TorusGeometry(1.18, 0.022, 12, 64);
    const innerRingMat = new THREE.MeshBasicMaterial({
      color: palette.hubCore,
      transparent: true,
      opacity: 0.65,
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.position.copy(hubPos);
    innerRing.rotation.x = -Math.PI * 0.36;
    innerRing.rotation.y = Math.PI * 0.2;
    scene.add(innerRing);

    disposableGeos.push(outerRingGeo, innerRingGeo);
    disposableMats.push(outerRingMat, innerRingMat);

    nodeVisuals.push({
      id: 'hub',
      label: profile.name,
      sub: profile.live ? 'LIVE' : 'OFFLINE',
      position: hubPos.clone().add(new THREE.Vector3(0, 1.35, 0)),
      mesh: hubMesh,
      baseScale: 1,
    });

    // 2. Left Arc — Buyers
    const buyerGeo = new THREE.SphereGeometry(0.36, 24, 24);
    disposableGeos.push(buyerGeo);

    const buyers = topology.buyers;
    const arcEntries: Array<{ mesh: THREE.Mesh; fromId: string; toId: string; baseOpacity: number }> = [];
    const packets: ArcPacket[] = [];

    const maxBuyerMicro = Math.max(...buyers.map((b) => b.settledMicro), 1);
    const buyerList =
      buyers.length > 0
        ? buyers
        : [
            {
              id: 'buyer:quiet',
              address: '',
              label: 'Awaiting buyers',
              channels: 0,
              settledMicro: 0,
              settles: 0,
              recentRequests: 0,
              recentTokens: 0,
              lastActivityTs: 0,
              models: [],
            },
          ];

    buyerList.forEach((b, idx) => {
      const count = buyerList.length;
      const t = count === 1 ? 0 : (idx / (count - 1)) * 2 - 1;
      const angle = Math.PI + t * 0.72;
      const radius = 5.7;
      // t = -1 sits in front (+z, lower y), t = +1 sits farther back (-z, higher y) for crisp visual cascade
      const pos = new THREE.Vector3(
        Math.cos(angle) * radius,
        0.15 + t * 1.1,
        Math.sin(angle) * radius * 0.9,
      );

      const scale =
        b.id === 'buyer:quiet'
          ? 0.85
          : 0.78 + Math.sqrt(b.settledMicro / maxBuyerMicro) * 0.65;

      const mat = new THREE.MeshStandardMaterial({
        color: palette.buyer,
        emissive: palette.buyer,
        emissiveIntensity: b.id === 'buyer:quiet' ? 0.12 : isDark ? 0.42 : 0.18,
        roughness: 0.28,
        metalness: 0.2,
        transparent: b.id === 'buyer:quiet',
        opacity: b.id === 'buyer:quiet' ? 0.45 : 1,
      });
      const mesh = new THREE.Mesh(buyerGeo, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(scale);
      mesh.userData = { nodeId: b.id };
      scene.add(mesh);
      if (b.id !== 'buyer:quiet') pickableMeshes.push(mesh);
      disposableMats.push(mat);

      nodeVisuals.push({
        id: b.id,
        label: b.label,
        sub: b.settles > 0 ? `${b.settles} settles` : undefined,
        position: pos.clone().add(new THREE.Vector3(0, 0.55 * scale + 0.25, 0)),
        mesh,
        baseScale: scale,
      });

      // Curved arc Buyer -> Hub
      const mid = pos.clone().lerp(hubPos, 0.5).add(new THREE.Vector3(0, 1.15 + Math.abs(t) * 0.4, 0));
      const curve = new THREE.QuadraticBezierCurve3(pos, mid, hubPos);
      const tubeGeo = new THREE.TubeGeometry(curve, 36, b.id === 'buyer:quiet' ? 0.018 : 0.032, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: palette.buyer,
        transparent: true,
        opacity: b.id === 'buyer:quiet' ? 0.18 : isDark ? 0.42 : 0.36,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      scene.add(tubeMesh);
      disposableGeos.push(tubeGeo);
      disposableMats.push(tubeMat);
      arcEntries.push({
        mesh: tubeMesh,
        fromId: b.id,
        toId: 'hub',
        baseOpacity: b.id === 'buyer:quiet' ? 0.18 : isDark ? 0.42 : 0.36,
      });

      if (b.id !== 'buyer:quiet') {
        const packetCount = Math.min(5, Math.max(2, Math.ceil(b.settles / 4) + 1));
        for (let p = 0; p < packetCount; p++) {
          packets.push({
            curve,
            t: p / packetCount,
            speed: 0.19 + (idx % 3) * 0.035,
            color: new THREE.Color(palette.buyer),
            fromId: b.id,
            toId: 'hub',
          });
        }
      }
    });

    // 3. Right Arc — Direct Upstream + AntSeed Fallback Peers
    const directGeo = new THREE.OctahedronGeometry(0.55, 0);
    const peerGeo = new THREE.DodecahedronGeometry(0.36, 0);
    disposableGeos.push(directGeo, peerGeo);

    const upstreams = topology.upstreams;
    upstreams.forEach((u, idx) => {
      const count = upstreams.length;
      const t = count === 1 ? 0 : (idx / (count - 1)) * 2 - 1;
      const angle = t * 0.68;
      const radius = u.kind === 'direct' ? 5.6 : 6.2;
      const pos = new THREE.Vector3(
        Math.cos(angle) * radius,
        u.kind === 'direct' ? 0.85 : -0.15 + Math.cos(idx * 1.3) * 0.45,
        Math.sin(angle) * radius * 0.88,
      );

      const isDirect = u.kind === 'direct';
      const scale = isDirect ? 1 : 0.8 + Math.min(0.45, u.backedModels.length * 0.06);
      const nodeColor = isDirect ? palette.direct : palette.peer;

      const mat = new THREE.MeshStandardMaterial({
        color: nodeColor,
        emissive: nodeColor,
        emissiveIntensity: isDark ? 0.44 : 0.2,
        roughness: 0.25,
        metalness: 0.3,
        flatShading: true,
      });
      const mesh = new THREE.Mesh(isDirect ? directGeo : peerGeo, mat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(scale);
      mesh.userData = { nodeId: u.id };
      scene.add(mesh);
      pickableMeshes.push(mesh);
      disposableMats.push(mat);

      nodeVisuals.push({
        id: u.id,
        label: u.label,
        sub: isDirect ? 'Primary' : `${u.backedModels.length}m`,
        position: pos.clone().add(new THREE.Vector3(0, 0.62 * scale + 0.25, 0)),
        mesh,
        baseScale: scale,
      });

      const mid = hubPos.clone().lerp(pos, 0.5).add(new THREE.Vector3(0, 1.2 + Math.abs(t) * 0.35, 0));
      const curve = new THREE.QuadraticBezierCurve3(hubPos, mid, pos);
      const tubeGeo = new THREE.TubeGeometry(curve, 36, isDirect ? 0.042 : 0.026, 8, false);
      const tubeMat = new THREE.MeshBasicMaterial({
        color: nodeColor,
        transparent: true,
        opacity: isDirect ? (isDark ? 0.55 : 0.48) : isDark ? 0.36 : 0.32,
      });
      const tubeMesh = new THREE.Mesh(tubeGeo, tubeMat);
      scene.add(tubeMesh);
      disposableGeos.push(tubeGeo);
      disposableMats.push(tubeMat);
      arcEntries.push({
        mesh: tubeMesh,
        fromId: 'hub',
        toId: u.id,
        baseOpacity: isDirect ? (isDark ? 0.55 : 0.48) : isDark ? 0.36 : 0.32,
      });

      const packetCount = isDirect ? 4 : Math.min(3, Math.max(1, Math.ceil(u.backedModels.length / 3)));
      for (let p = 0; p < packetCount; p++) {
        packets.push({
          curve,
          t: p / packetCount,
          speed: isDirect ? 0.24 : 0.16 + (idx % 3) * 0.025,
          color: new THREE.Color(nodeColor),
          fromId: 'hub',
          toId: u.id,
        });
      }
    });

    // Instanced traffic packets
    const packetGeo = new THREE.SphereGeometry(0.11, 10, 10);
    const packetMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const instancedPackets = new THREE.InstancedMesh(
      packetGeo,
      packetMat,
      Math.max(1, packets.length),
    );
    instancedPackets.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    packets.forEach((p, idx) => {
      instancedPackets.setColorAt(idx, p.color);
    });
    if (instancedPackets.instanceColor) {
      instancedPackets.instanceColor.needsUpdate = true;
    }
    scene.add(instancedPackets);
    disposableGeos.push(packetGeo);
    disposableMats.push(packetMat);

    // Raycasting for hover & tap selection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = { x: 0, y: 0 };

    const pickNode = (clientX: number, clientY: number): string | null => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickableMeshes, false);
      const first = hits[0];
      return first ? (first.object.userData.nodeId as string) : null;
    };

    const onPointerMove = (e: PointerEvent) => {
      const hit = pickNode(e.clientX, e.clientY);
      if (hit !== hoveredRef.current) {
        hoveredRef.current = hit;
        setHoveredId(hit);
        canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      if (dist > 6) return; // Dragged camera, not a click/tap
      const hit = pickNode(e.clientX, e.clientY);
      onSelect(hit === selectedRef.current ? null : hit);
    };

    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointerup', onPointerUp);

    // Responsive ResizeObserver
    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(200, Math.floor(entry.contentRect.width));
      const h = Math.max(200, Math.floor(entry.contentRect.height));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    resizeObserver.observe(container);

    // Animation loop with visibility pause & adaptive quality
    let rafId = 0;
    let lastTime = performance.now();
    let frameCounter = 0;
    let slowFrames = 0;
    let qualityReduced = false;
    const dummy = new THREE.Object3D();
    const tmpVec = new THREE.Vector3();
    let labelTick = 0;

    const projectLabels = () => {
      const cw = container.clientWidth || 640;
      const ch = container.clientHeight || 420;
      const padX = Math.min(72, cw * 0.18);
      const projected: ProjectedLabel[] = nodeVisuals.map((nv) => {
        tmpVec.copy(nv.position).project(camera);
        const visible = tmpVec.z < 1 && tmpVec.x >= -1.02 && tmpVec.x <= 1.02 && tmpVec.y >= -0.95 && tmpVec.y <= 0.95;
        const rawX = (tmpVec.x * 0.5 + 0.5) * cw;
        const rawY = (-tmpVec.y * 0.5 + 0.5) * ch;
        return {
          id: nv.id,
          text: nv.label,
          sub: nv.sub,
          x: Math.max(padX, Math.min(cw - padX, rawX)),
          y: Math.max(66, Math.min(ch - 62, rawY)),
          visible,
        };
      });

      // Lightweight screen-space vertical separation so floating chips never collide
      const vis = projected.filter((p) => p.visible).sort((a, b) => a.y - b.y);
      for (let i = 1; i < vis.length; i++) {
        const cur = vis[i]!;
        for (let j = 0; j < i; j++) {
          const prev = vis[j]!;
          if (Math.abs(cur.x - prev.x) < 135 && cur.y - prev.y < 28) {
            cur.y = Math.min(ch - 62, prev.y + 28);
          }
        }
      }

      setLabels(projected);
    };

    const renderFrame = (now: number) => {
      if (document.visibilityState === 'hidden') {
        rafId = 0;
        return;
      }

      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      // Adaptive quality: if frames consistently exceed 32ms (<31 FPS), lower DPR cap once
      frameCounter += 1;
      if (dt > 0.032) slowFrames += 1;
      if (!qualityReduced && frameCounter > 45 && slowFrames / frameCounter > 0.45) {
        qualityReduced = true;
        dprCap = Math.min(dprCap, 1.25);
        renderer.setPixelRatio(dprCap);
      }

      if (!reducedMotion) {
        hubMesh.rotation.y += dt * 0.35;
        outerRing.rotation.z += dt * 0.45;
        innerRing.rotation.z -= dt * 0.62;
      }

      const focusId = selectedRef.current || hoveredRef.current;

      // Highlight selected / hovered arcs
      for (const arc of arcEntries) {
        const mat = arc.mesh.material as THREE.MeshBasicMaterial;
        const isLit = !focusId || focusId === 'hub' || arc.fromId === focusId || arc.toId === focusId;
        mat.opacity = isLit ? Math.min(0.9, arc.baseOpacity * (focusId ? 1.55 : 1)) : 0.09;
      }

      // Highlight nodes
      for (const nv of nodeVisuals) {
        const isHot = nv.id === focusId;
        const targetScale = nv.baseScale * (isHot ? 1.22 : 1);
        nv.mesh.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.14);
      }

      // Advance traffic packets along Bezier arcs
      const stride = qualityReduced ? 2 : 1;
      packets.forEach((p, i) => {
        if (!reducedMotion) {
          p.t = (p.t + dt * p.speed) % 1;
        }
        const isLit = !focusId || focusId === 'hub' || p.fromId === focusId || p.toId === focusId;
        if (i % stride !== 0 || !isLit) {
          dummy.scale.setScalar(0.0001);
        } else {
          p.curve.getPoint(p.t, tmpVec);
          dummy.position.copy(tmpVec);
          const pulse = 0.85 + Math.sin(p.t * Math.PI) * 0.45;
          dummy.scale.setScalar(pulse);
        }
        dummy.updateMatrix();
        instancedPackets.setMatrixAt(i, dummy.matrix);
      });
      instancedPackets.instanceMatrix.needsUpdate = true;

      controls.update();
      renderer.render(scene, camera);

      // Update projected HTML labels every 3 frames (~20Hz) for crisp smoothness with low React churn
      labelTick += 1;
      if (labelTick % 3 === 0 || labelTick === 1) {
        projectLabels();
      }

      rafId = window.requestAnimationFrame(renderFrame);
    };

    const startLoop = () => {
      if (rafId === 0 && document.visibilityState !== 'hidden') {
        lastTime = performance.now();
        rafId = window.requestAnimationFrame(renderFrame);
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (rafId !== 0) {
          window.cancelAnimationFrame(rafId);
          rafId = 0;
        }
      } else {
        startLoop();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Render first frame immediately
    projectLabels();
    startLoop();

    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      document.removeEventListener('visibilitychange', onVisibility);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      controls.dispose();
      ringMat.dispose();
      floorGroup.traverse((obj) => {
        if (obj instanceof THREE.Line) obj.geometry.dispose();
      });
      disposableGeos.forEach((g) => g.dispose());
      disposableMats.forEach((m) => m.dispose());
      renderer.dispose();
    };
  }, [topology, profile, theme, reducedMotion, onSelect, onContextLost]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        aria-label={`Interactive 3D topology canvas for ${profile.name}`}
      />

      {/* Crisp projected HTML node labels */}
      <div className="scene-label-layer" aria-hidden={false}>
        {labels.map((lbl) => {
          if (!lbl.visible) return null;
          const isSelected = selectedId === lbl.id || hoveredId === lbl.id;
          return (
            <button
              key={lbl.id}
              type="button"
              className={`scene-label-chip${isSelected ? ' selected' : ''}`}
              style={{ left: `${lbl.x}px`, top: `${lbl.y}px` }}
              onClick={() => onSelect(selectedId === lbl.id ? null : lbl.id)}
            >
              <span>{lbl.text}</span>
              {lbl.sub && (
                <span style={{ color: 'var(--ink-3)', marginLeft: 5 }}>{lbl.sub}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
