import React, { useState, useMemo, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Grid, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';

// --- 沙盘物理常量 ---
const TABLE_WIDTH = 8.1;
const TABLE_LENGTH = 4.963;
const IPAD_ASPECT = 4 / 3;

// --- 核心：视锥与地面相交数学解算组件 ---
const FOVProjector = ({ position, pitch, yaw, fov, onUpdate }) => {
  const { groundGeo, rayGeo, area, coverage } = useMemo(() => {
    const virtualCamera = new THREE.PerspectiveCamera(fov, IPAD_ASPECT, 0.1, 100);
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
    }
    
    const totalTableArea = TABLE_WIDTH * TABLE_LENGTH;
    const currentCoverage = Math.min((currentArea / totalTableArea) * 100, 100);

    return { groundGeo: groundGeometry, rayGeo: rayGeometry, area: currentArea, coverage: currentCoverage };
  }, [position, pitch, yaw, fov]);

  useEffect(() => { if (onUpdate) onUpdate({ area, coverage }); }, [area, coverage, onUpdate]);

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

// --- 沙盘环境组件 (被主视图和 PIP 视图共享) ---
const SandTableEnvironment = ({ texture }) => (
  <group>
    {/* 沙盘基底带贴图 */}
    <mesh position={[TABLE_WIDTH/2, -0.01, TABLE_LENGTH/2]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[TABLE_WIDTH, TABLE_LENGTH]} />
      <meshStandardMaterial color="#ffffff" map={texture} />
    </mesh>
    {/* 沙盘网格尺标 */}
    <Grid 
      position={[TABLE_WIDTH/2, 0, TABLE_LENGTH/2]} args={[TABLE_WIDTH, TABLE_LENGTH]} 
      cellSize={0.5} cellThickness={1} cellColor="#e0e0e0" 
      sectionSize={1} sectionThickness={1.5} sectionColor="#c0c0c0" 
      infiniteGrid={false} fadeDistance={50} 
    />
    {/* 原点指示器 (0,0) */}
    <mesh position={[0, 0.05, 0]}>
      <sphereGeometry args={[0.08, 16, 16]} />
      <meshBasicMaterial color="#ff3b30" />
    </mesh>
  </group>
);

// --- PIP 专属相机控制器 ---
// 负责强行接管 PIP 画布的相机，使其与参数完全同步
const PIPCameraController = ({ position, pitch, yaw, fov }) => {
  const { camera } = useThree();
  useEffect(() => {
    camera.fov = fov;
    camera.position.set(position[0], position[1], position[2]);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(-pitch * (Math.PI / 180), -yaw * (Math.PI / 180), 0);
    camera.updateProjectionMatrix();
  }, [position, pitch, yaw, fov, camera]);
  return null;
};

// --- 主程序 ---
export default function App() {
  const [posX, setPosX] = useState(4.05); 
  const [posY, setPosY] = useState(2.0);  
  const [posZ, setPosZ] = useState(2.48); 
  const [pitch, setPitch] = useState(60); 
  const [yaw, setYaw] = useState(0);      
  const [fov, setFov] = useState(65);     
  const [telemetry, setTelemetry] = useState({ area: 0, coverage: 0 });
  const [sandTexture, setSandTexture] = useState(null);

  // 安全加载沙盘图片资源
  useEffect(() => {
    const loader = new THREE.TextureLoader();
    const imgPath = import.meta.env.BASE_URL + 'sandtable.jpg';

    loader.load(imgPath, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      setSandTexture(tex);
    }, undefined, (err) => {
      console.warn("未找到图片，尝试加载路径:", imgPath);
    });
  }, []);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* 左侧控制面板 */}
      <div style={{ width: '320px', backgroundColor: '#f5f5f7', borderRight: '1px solid #d2d2d7', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
        <div>
          <h2 style={{ margin: '0 0 8px 0', fontSize: '20px', fontWeight: '600', color: '#1d1d1f' }}>AR 视场仿真系统</h2>
          <p style={{ margin: 0, fontSize: '13px', color: '#86868b' }}>原点 (0,0) 位于沙盘左下角</p>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#1d1d1f' }}>空间坐标控制</h3>
          <ControlSlider label="X轴 (长边)" min={-1.0} max={TABLE_WIDTH + 1.0} step={0.01} value={posX} onChange={setPosX} />
          <ControlSlider label="Y轴 (高度)" min={0.5} max={4.0} step={0.01} value={posY} onChange={setPosY} />
          <ControlSlider label="Z轴 (短边)" min={-1.0} max={TABLE_LENGTH + 1.0} step={0.01} value={posZ} onChange={setPosZ} />
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#1d1d1f' }}>设备姿态</h3>
          <ControlSlider label="俯仰角 (Pitch)" min={0} max={90} step={1} value={pitch} onChange={setPitch} />
          <ControlSlider label="偏航角 (Yaw)" min={-180} max={180} step={1} value={yaw} onChange={setYaw} />
          <ControlSlider label="相机视角 (FOV)" min={45} max={90} step={1} value={fov} onChange={setFov} />
        </div>

        <div style={{ backgroundColor: '#1d1d1f', padding: '16px', borderRadius: '12px', color: '#fff' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#a1a1a6' }}>实时侦测数据</h3>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span style={{ fontSize: '13px' }}>投影面积:</span>
            <span style={{ fontWeight: '500' }}>{telemetry.area.toFixed(2)} ㎡</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '13px' }}>覆盖率:</span>
            <span style={{ fontWeight: '500', color: telemetry.coverage > 80 ? '#34c759' : '#fff' }}>
              {telemetry.coverage.toFixed(1)} %
            </span>
          </div>
        </div>
      </div>

      {/* 右侧主 3D 视窗 */}
      <div style={{ flex: 1, position: 'relative', backgroundColor: '#e5e5ea' }}>
        <Canvas camera={{ position: [TABLE_WIDTH/2, 6, TABLE_LENGTH + 4], fov: 50 }}>
          <ambientLight intensity={0.5} />
          <directionalLight position={[10, 10, 5]} intensity={1} />
          <OrbitControls target={[TABLE_WIDTH/2, 0, TABLE_LENGTH/2]} />

          <group>
            {/* 注入沙盘环境 */}
            <SandTableEnvironment texture={sandTexture} />
            
            {/* iPad 实体模型 */}
            <group position={[posX, posY, posZ]} rotation={[-pitch * (Math.PI/180), -yaw * (Math.PI/180), 0]} rotation-order='YXZ'>
              <mesh>
                <boxGeometry args={[0.28, 0.21, 0.01]} />
                <meshStandardMaterial color="#4a4a4a" />
              </mesh>
              <mesh position={[0, 0, 0.006]}>
                <planeGeometry args={[0.26, 0.19]} />
                <meshBasicMaterial color="#000000" />
              </mesh>
              <mesh position={[0, 0, -0.006]}>
                <circleGeometry args={[0.01, 16]} />
                <meshBasicMaterial color="#ff3b30" />
              </mesh>
            </group>

            {/* 数学射线投影 */}
            <FOVProjector position={[posX, posY, posZ]} pitch={pitch} yaw={yaw} fov={fov} onUpdate={setTelemetry} />
          </group>
        </Canvas>

        {/* --- 右上角 PIP 画中画监控窗 --- */}
        <div style={{ 
          position: 'absolute', top: '24px', right: '24px', 
          width: '320px', height: '240px', // 严格遵守 iPad 4:3 比例
          backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '2px solid rgba(255,255,255,0.2)',
          pointerEvents: 'none' // 让鼠标穿透，不影响底层的主场景旋转
        }}>
          {/* 画中画标题栏 */}
          <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 10, color: '#fff', fontSize: '12px', fontWeight: 'bold', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '4px' }}>
            ● iPad 实时视角
          </div>
          
          {/* PIP 独立画布 */}
          <Canvas>
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 10, 5]} intensity={1} />
            {/* 控制器接管此相机的姿态，强制对齐 iPad */}
            <PIPCameraController position={[posX, posY, posZ]} pitch={pitch} yaw={yaw} fov={fov} />
            <SandTableEnvironment texture={sandTexture} />
          </Canvas>
        </div>
      </div>
    </div>
  );
}

// --- 带极限值保护与手动输入的高级滑块组件 ---
function ControlSlider({ label, min, max, step, value, onChange }) {
  const [inputValue, setInputValue] = useState(value);

  // 当外部滑块拖动时，同步更新输入框的数字
  useEffect(() => { setInputValue(value.toFixed(2)); }, [value]);

  // 输入框失去焦点或按下回车时，执行边界检查并生效
  const commitValue = () => {
    let parsed = parseFloat(inputValue);
    if (isNaN(parsed)) parsed = value;
    if (parsed < min) parsed = min; // 限制最小值
    if (parsed > max) parsed = max; // 限制最大值
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
          type="number" value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={commitValue}
          onKeyDown={(e) => { if (e.key === 'Enter') commitValue(); }}
          style={{ 
            width: '64px', padding: '4px', fontSize: '12px', fontFamily: 'monospace',
            border: '1px solid #d2d2d7', borderRadius: '6px', textAlign: 'center' 
          }}
        />
      </div>
    </div>
  );
}