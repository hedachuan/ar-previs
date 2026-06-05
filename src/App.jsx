import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// --- 工具函数：从网址读取参数 ---
const getUrlParam = (key, defaultVal) => {
  const params = new URLSearchParams(window.location.search);
  const val = params.get(key);
  return val !== null && !isNaN(parseFloat(val)) ? parseFloat(val) : defaultVal;
};

// --- 核心：视锥与地面相交数学解算组件 ---
const FOVProjector = ({ position, pitch, yaw, fov, aspectRatio, tableWidth, tableLength, onUpdate }) => {
  const { groundGeo, rayGeo, area, coverage, centerDistance } = useMemo(() => {
    const virtualCamera = new THREE.PerspectiveCamera(fov, aspectRatio, 0.1, 100);
    virtualCamera.position.set(position[0], position[1], position[2]);
    virtualCamera.rotation.order = 'YXZ';
    virtualCamera.rotation.set(-pitch * (Math.PI / 180), -yaw * (Math.PI / 180), 0);
    virtualCamera.updateMatrixWorld();

    const getGroundIntersection = (ndcX, ndcY) => {
      const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
      vec.unproject(virtualCamera);
      vec.sub(virtualCamera.position).normalize();
      if (vec.y >= 0) return null; 
      const t = -virtualCamera.position.y / vec.y;
      return new THREE.Vector3().copy(virtualCamera.position).add(vec.multiplyScalar(t));
    };

    const pTopLeft = getGroundIntersection(-1, 1);
    const pTopRight = getGroundIntersection(1, 1);
    const pBottomRight = getGroundIntersection(1, -1);
    const pBottomLeft = getGroundIntersection(-1, -1);

    const groundGeometry = new THREE.BufferGeometry();
    const rayGeometry = new THREE.BufferGeometry();
    let currentArea = 0;
    let dist = 0;

    if (pTopLeft && pTopRight && pBottomRight && pBottomLeft) {
      const vertices = new Float32Array([
        pTopLeft.x, 0.01, pTopLeft.z,     pBottomLeft.x, 0.01, pBottomLeft.z, pTopRight.x, 0.01, pTopRight.z,
        pTopRight.x, 0.01, pTopRight.z,   pBottomLeft.x, 0.01, pBottomLeft.z, pBottomRight.x, 0.01, pBottomRight.z,
      ]);
      groundGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      
      const rayVertices = new Float32Array([
        position[0], position[1], position[2],  pTopLeft.x, 0.01, pTopLeft.z,
        position[0], position[1], position[2],  pTopRight.x, 0.01, pTopRight.z,
        position[0], position[1], position[2],  pBottomRight.x, 0.01, pBottomRight.z,
        position[0], position[1], position[2],  pBottomLeft.x, 0.01, pBottomLeft.z,
      ]);
      rayGeometry.setAttribute('position', new THREE.BufferAttribute(rayVertices, 3));

      const v1 = new THREE.Vector3().subVectors(pBottomLeft, pTopLeft);
      const v2 = new THREE.Vector3().subVectors(pTopRight, pTopLeft);
      const area1 = new THREE.Vector3().crossVectors(v1, v2).length() / 2;
      const v3 = new THREE.Vector3().subVectors(pBottomLeft, pBottomRight);
      const v4 = new THREE.Vector3().subVectors(pTopRight, pBottomRight);
      const area2 = new THREE.Vector3().crossVectors(v3, v4).length() / 2;
      currentArea = area1 + area2;

      const centerTarget = getGroundIntersection(0, 0);
      if (centerTarget) {
        dist = virtualCamera.position.distanceTo(centerTarget);
      }
    }
    
    const totalTableArea = tableWidth * tableLength;
    const currentCoverage = Math.min((currentArea / totalTableArea) * 100, 100);

    return { groundGeo: groundGeometry, rayGeo: rayGeometry, area: currentArea, coverage: currentCoverage, centerDistance: dist };
  }, [position, pitch, yaw, fov, aspectRatio, tableWidth, tableLength]);

  useEffect(() => { if (onUpdate) onUpdate({ area, coverage, centerDistance }); }, [area, coverage, centerDistance, onUpdate]);

  return (
    <>
      <mesh geometry={groundGeo}>
        <meshBasicMaterial color="#007AFF" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      <lineSegments>
        <edgesGeometry args={[groundGeo]} />
        <lineBasicMaterial color="#007AFF" linewidth={2} />
      </lineSegments>
      <lineSegments geometry={rayGeo}>
        <lineBasicMaterial color="#007AFF" transparent opacity={0.5} />
      </lineSegments>
    </>
  );
};

// --- 沙盘环境组件 ---
const SandTableEnvironment = ({ texture, width, length, showGrid }) => (
  <group>
    <mesh position={[width/2, -0.01, length/2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[width, length]} />
      <meshStandardMaterial color="#ffffff" map={texture} />
    </mesh>
    {showGrid && (
      <Grid 
        position={[width/2, 0, length/2]} args={[width, length]} 
        cellSize={0.5} cellThickness={1} cellColor="#e0e0e0" 
        sectionSize={1} sectionThickness={1.5} sectionColor="#c0c0c0" 
        infiniteGrid={false} fadeDistance={50} 
      />
    )}
    <mesh position={[0, 0.05, 0]}>
      <sphereGeometry args={[0.08, 16, 16]} />
      <meshBasicMaterial color="#ff3b30" />
    </mesh>
  </group>
);

const PIPCameraController = ({ position, pitch, yaw, fov, aspectRatio }) => {
  const { camera } = useThree();
  useEffect(() => {
    camera.fov = fov;
    camera.aspect = aspectRatio;
    camera.position.set(position[0], position[1], position[2]);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-pitch * (Math.PI / 180), -yaw * (Math.PI / 180), 0);
    camera.updateProjectionMatrix();
  }, [position, pitch, yaw, fov, aspectRatio, camera]);
  return null;
};

export default function App() {
  // 1. 初始化时优先读取 URL 参数，如果没有则使用默认值
  const [tableWidth, setTableWidth] = useState(() => getUrlParam('tw', 8.1));
  const [tableLength, setTableLength] = useState(() => getUrlParam('tl', 4.96));
  const [posX, setPosX] = useState(() => getUrlParam('x', 4.05)); 
  const [posY, setPosY] = useState(() => getUrlParam('y', 2.0));  
  const [posZ, setPosZ] = useState(() => getUrlParam('z', 2.48)); 
  const [pitch, setPitch] = useState(() => getUrlParam('p', 60)); 
  const [yaw, setYaw] = useState(() => getUrlParam('yw', 0));      
  const [fov, setFov] = useState(() => getUrlParam('f', 65)); 
  const [aspectRatio, setAspectRatio] = useState(() => getUrlParam('ar', 4/3));
  
  const [showGrid, setShowGrid] = useState(true);
  const [showPIP, setShowPIP] = useState(true);

  const [telemetry, setTelemetry] = useState({ area: 0, coverage: 0, centerDistance: 0 });
  const [sandTexture, setSandTexture] = useState(null);
  
  // 图片加载状态 UI
  const [imgStatus, setImgStatus] = useState('初始化...');

  // 2. 监听参数变化，实时写入 URL（用于一键分享和防止刷新丢失）
  useEffect(() => {
    const params = new URLSearchParams();
    params.set('tw', tableWidth.toFixed(2));
    params.set('tl', tableLength.toFixed(2));
    params.set('x', posX.toFixed(2));
    params.set('y', posY.toFixed(2));
    params.set('z', posZ.toFixed(2));
    params.set('p', pitch.toFixed(0));
    params.set('yw', yaw.toFixed(0));
    params.set('f', fov.toFixed(0));
    params.set('ar', aspectRatio.toFixed(3));
    
    // 替换当前网址，不会引起页面重载
    window.history.replaceState(null, '', '?' + params.toString());
  }, [tableWidth, tableLength, posX, posY, posZ, pitch, yaw, fov, aspectRatio]);

  // 加载图片并更新状态
  useEffect(() => {
    setImgStatus('正在下载贴图...');
    const loader = new THREE.TextureLoader();
    const imgPath = import.meta.env.BASE_URL + 'sandtable.jpg';
    loader.load(
      imgPath, 
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        setSandTexture(tex);
        setImgStatus('已加载完成');
      }, 
      undefined, 
      () => setImgStatus('未找到图片(使用纯白底)')
    );
  }, []);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* 左侧控制面板 */}
      <div style={{ width: '340px', backgroundColor: '#f5f5f7', borderRight: '1px solid #d2d2d7', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: '600', color: '#1d1d1f' }}>AR 视场仿真引擎</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#86868b' }}>
            <span>原点 (0,0) 绑定左下角</span>
            {/* 贴图加载状态指示 */}
            <span style={{ color: imgStatus === '已加载完成' ? '#34c759' : '#ff9500' }}>{imgStatus}</span>
          </div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#1d1d1f' }}>沙盘物理尺寸 (米)</h3>
          <ControlSlider label="宽度 Width (X轴)" min={1.0} max={20.0} step={0.1} value={tableWidth} onChange={setTableWidth} />
          <ControlSlider label="长度 Length (Z轴)" min={1.0} max={20.0} step={0.1} value={tableLength} onChange={setTableLength} />
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#1d1d1f' }}>设备空间坐标</h3>
          <ControlSlider label="X轴位置" min={-2.0} max={tableWidth + 2.0} step={0.01} value={posX} onChange={setPosX} />
          <ControlSlider label="Y轴高度" min={0.1} max={6.0} step={0.01} value={posY} onChange={setPosY} />
          <ControlSlider label="Z轴位置" min={-2.0} max={tableLength + 2.0} step={0.01} value={posZ} onChange={setPosZ} />
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: '#1d1d1f' }}>摄像机参数</h3>
            <select 
              value={aspectRatio} onChange={(e) => setAspectRatio(parseFloat(e.target.value))}
              style={{ fontSize: '12px', padding: '4px', borderRadius: '6px', border: '1px solid #d2d2d7' }}
            >
              <option value={4/3}>iPad Pro (4:3)</option>
              <option value={16/9}>iPhone / 手机 (16:9)</option>
            </select>
          </div>
          <ControlSlider label="俯仰角 (Pitch)" min={0} max={90} step={1} value={pitch} onChange={setPitch} />
          <ControlSlider label="偏航角 (Yaw)" min={-180} max={180} step={1} value={yaw} onChange={setYaw} />
          <ControlSlider label="有效垂直 FOV" min={45} max={90} step={1} value={fov} onChange={setFov} />
        </div>

        <div style={{ backgroundColor: '#1d1d1f', padding: '16px', borderRadius: '12px', color: '#fff' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#a1a1a6' }}>实时侦测中心</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
            <span>当前投影面积:</span><span style={{ fontWeight: '500' }}>{telemetry.area.toFixed(2)} ㎡</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '13px' }}>
            <span>沙盘覆盖率:</span>
            <span style={{ fontWeight: '500', color: telemetry.coverage > 80 ? '#34c759' : '#fff' }}>{telemetry.coverage.toFixed(1)} %</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', borderTop: '1px solid #333', paddingTop: '8px', marginTop: '8px' }}>
            <span>LiDAR 视距预估:</span>
            <span style={{ fontWeight: '500', color: telemetry.centerDistance > 5 ? '#ff3b30' : '#34c759' }}>
              {telemetry.centerDistance.toFixed(2)} m {telemetry.centerDistance > 5 && '(过远)'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => setShowGrid(!showGrid)} style={btnStyle(showGrid)}>网格辅助线</button>
          <button onClick={() => setShowPIP(!showPIP)} style={btnStyle(showPIP)}>PIP 画中画</button>
        </div>
      </div>

      {/* 右侧主 3D 视窗 */}
      <div style={{ flex: 1, position: 'relative', backgroundColor: '#e5e5ea' }}>
        <Canvas camera={{ position: [tableWidth/2, Math.max(tableWidth, tableLength) * 0.8, tableLength + 4], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <OrbitControls target={[tableWidth/2, 0, tableLength/2]} />

          <group>
            <SandTableEnvironment texture={sandTexture} width={tableWidth} length={tableLength} showGrid={showGrid} />
            
            <group position={[posX, posY, posZ]} rotation={[-pitch * (Math.PI/180), -yaw * (Math.PI/180), 0]} rotation-order='YXZ'>
              <mesh><boxGeometry args={[0.28, 0.21, 0.01]} /><meshStandardMaterial color="#4a4a4a" /></mesh>
              <mesh position={[0, 0, 0.006]}><planeGeometry args={[0.26, 0.19]} /><meshBasicMaterial color="#000000" /></mesh>
              <mesh position={[0, 0, -0.006]}><circleGeometry args={[0.01, 16]} /><meshBasicMaterial color="#ff3b30" /></mesh>
            </group>

            <FOVProjector 
              position={[posX, posY, posZ]} pitch={pitch} yaw={yaw} fov={fov} 
              aspectRatio={aspectRatio} tableWidth={tableWidth} tableLength={tableLength} onUpdate={setTelemetry} 
            />
          </group>
        </Canvas>

        {/* 右上角 PIP 动态画中画 */}
        {showPIP && (
          <div style={{ 
            position: 'absolute', top: '24px', right: '24px', width: '320px', height: `${320 / aspectRatio}px`,
            backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '2px solid rgba(255,255,255,0.2)', pointerEvents: 'none', transition: 'height 0.3s'
          }}>
            <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 10, color: '#fff', fontSize: '12px', fontWeight: 'bold', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '4px' }}>
              ● 实时取景器
            </div>
            <Canvas>
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 10, 5]} intensity={1} />
              <PIPCameraController position={[posX, posY, posZ]} pitch={pitch} yaw={yaw} fov={fov} aspectRatio={aspectRatio} />
              <SandTableEnvironment texture={sandTexture} width={tableWidth} length={tableLength} showGrid={false} />
            </Canvas>
          </div>
        )}
      </div>
    </div>
  );
}

const btnStyle = (active) => ({
  flex: 1, padding: '8px', fontSize: '12px', cursor: 'pointer', border: `1px solid ${active ? '#007AFF' : '#d2d2d7'}`,
  backgroundColor: active ? '#e5f0ff' : '#fff', color: active ? '#007AFF' : '#1d1d1f', borderRadius: '8px'
});

function ControlSlider({ label, min, max, step, value, onChange }) {
  const [inputValue, setInputValue] = useState(value);
  useEffect(() => { setInputValue(value.toFixed(2)); }, [value]);

  const commitValue = () => {
    let parsed = parseFloat(inputValue);
    if (isNaN(parsed)) parsed = value;
    if (parsed < min) parsed = min;
    if (parsed > max) parsed = max;
    setInputValue(parsed.toFixed(2));
    onChange(parsed);
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '12px', color: '#1d1d1f', marginBottom: '6px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input 
          type="range" min={min} max={max} step={step} value={value} 
          onChange={(e) => onChange(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: '#007AFF', cursor: 'pointer' }}
        />
        <input 
          type="number" value={inputValue} onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitValue} onKeyDown={(e) => { if (e.key === 'Enter') commitValue(); }}
          style={{ width: '64px', padding: '4px', fontSize: '12px', fontFamily: 'monospace', border: '1px solid #d2d2d7', borderRadius: '6px', textAlign: 'center' }}
        />
      </div>
    </div>
  );
}