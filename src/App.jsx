import { useState, useMemo, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { Grid, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import './App.css';

// --- 工具函数：从网址读取参数 ---
const getUrlParam = (key, defaultVal, min = -Infinity, max = Infinity) => {
  const params = new URLSearchParams(window.location.search);
  const rawValue = params.get(key);
  if (rawValue === null || rawValue.trim() === '') return defaultVal;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? THREE.MathUtils.clamp(parsed, min, max) : defaultVal;
};

const getUrlParamString = (key, defaultVal) => {
  const params = new URLSearchParams(window.location.search);
  const val = params.get(key);
  return ['4/3', '16/9', 'custom'].includes(val) ? val : defaultVal;
};

// --- 核心：视锥与地面相交数学解算组件 ---
const FOVProjector = ({ position, pitch, yaw, fov, aspectRatio, tableWidth, tableLength, onUpdate }) => {
  const { groundGeo, outlineGeo, rayGeo, area, coverage, centerDistance, hasFootprint } = useMemo(() => {
    const maxProjectionDistance = Math.max(tableWidth, tableLength, position[1]) * 20;
    const virtualCamera = new THREE.PerspectiveCamera(fov, aspectRatio, 0.1, maxProjectionDistance);
    virtualCamera.position.set(position[0], position[1], position[2]);
    virtualCamera.rotation.order = 'YXZ';
    virtualCamera.rotation.set(-pitch * (Math.PI / 180), -yaw * (Math.PI / 180), 0);
    virtualCamera.updateMatrixWorld();

    const getGroundIntersection = (ndcX, ndcY) => {
      const vec = new THREE.Vector3(ndcX, ndcY, 0.5);
      vec.unproject(virtualCamera);
      vec.sub(virtualCamera.position).normalize();
      // 地平线附近除数趋近 0，会产生极大坐标并破坏 WebGL 深度精度。
      if (vec.y >= -1e-4) return null;
      const t = -virtualCamera.position.y / vec.y;
      if (!Number.isFinite(t) || t <= 0 || t > maxProjectionDistance) return null;
      return new THREE.Vector3().copy(virtualCamera.position).add(vec.multiplyScalar(t));
    };

    const pTopLeft = getGroundIntersection(-1, 1);
    const pTopRight = getGroundIntersection(1, 1);
    const pBottomRight = getGroundIntersection(1, -1);
    const pBottomLeft = getGroundIntersection(-1, -1);

    const groundGeometry = new THREE.BufferGeometry();
    const outlineGeometry = new THREE.BufferGeometry();
    const rayGeometry = new THREE.BufferGeometry();
    let currentArea = 0;
    let dist = 0;
    const intersections = [pTopLeft, pTopRight, pBottomRight, pBottomLeft];
    const footprintIsValid = intersections.every(Boolean);

    if (footprintIsValid) {
      const vertices = new Float32Array([
        pTopLeft.x, 0.01, pTopLeft.z,     pBottomLeft.x, 0.01, pBottomLeft.z, pTopRight.x, 0.01, pTopRight.z,
        pTopRight.x, 0.01, pTopRight.z,   pBottomLeft.x, 0.01, pBottomLeft.z, pBottomRight.x, 0.01, pBottomRight.z,
      ]);
      groundGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));

      outlineGeometry.setFromPoints(
        [pTopLeft, pTopRight, pBottomRight, pBottomLeft, pTopLeft]
          .map((point) => new THREE.Vector3(point.x, 0.012, point.z)),
      );

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

    const validRayPoints = intersections.filter(Boolean);
    if (validRayPoints.length) {
      const rayVertices = validRayPoints.flatMap((point) => [
        position[0], position[1], position[2], point.x, 0.01, point.z,
      ]);
      rayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rayVertices, 3));
    }

    const totalTableArea = tableWidth * tableLength;
    const currentCoverage = Math.min((currentArea / totalTableArea) * 100, 100);

    return {
      groundGeo: groundGeometry,
      outlineGeo: outlineGeometry,
      rayGeo: rayGeometry,
      area: currentArea,
      coverage: currentCoverage,
      centerDistance: dist,
      hasFootprint: footprintIsValid,
    };
  }, [position, pitch, yaw, fov, aspectRatio, tableWidth, tableLength]);

  useEffect(() => {
    onUpdate?.({ area, coverage, centerDistance, hasFootprint });
  }, [area, coverage, centerDistance, hasFootprint, onUpdate]);

  return (
    <>
      {hasFootprint && (
        <>
          <mesh geometry={groundGeo}>
            <meshBasicMaterial color="#007AFF" transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <line geometry={outlineGeo}>
            <lineBasicMaterial color="#007AFF" />
          </line>
        </>
      )}
      {rayGeo.getAttribute('position') && (
        <lineSegments geometry={rayGeo}>
          <lineBasicMaterial color="#007AFF" transparent opacity={0.5} />
        </lineSegments>
      )}
    </>
  );
};

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

export default function App() {
  const [tableWidth, setTableWidth] = useState(() => getUrlParam('tw', 8.1, 1, 20));
  const [tableLength, setTableLength] = useState(() => getUrlParam('tl', 4.96, 1, 20));
  const [posX, setPosX] = useState(() => getUrlParam('x', 4.05, -2, 22));
  const [posY, setPosY] = useState(() => getUrlParam('y', 2.0, 0.1, 6));
  const [posZ, setPosZ] = useState(() => getUrlParam('z', 2.48, -2, 22));
  const [pitch, setPitch] = useState(() => getUrlParam('p', 60, 0, 90));
  const [yaw, setYaw] = useState(() => getUrlParam('yw', 0, -180, 180));
  const [fov, setFov] = useState(() => getUrlParam('f', 65, 45, 120));
  
  // --- 新增：画幅模式与自定义宽高 ---
  const [aspectMode, setAspectMode] = useState(() => getUrlParamString('am', '4/3'));
  const [customW, setCustomW] = useState(() => getUrlParam('cw', 1920, 1, 16384));
  const [customH, setCustomH] = useState(() => getUrlParam('ch', 1080, 1, 16384));
  
  const [showGrid, setShowGrid] = useState(true);
  const [showPIP, setShowPIP] = useState(true);
  const [telemetry, setTelemetry] = useState({ area: 0, coverage: 0, centerDistance: 0, hasFootprint: true });
  const [sandTexture, setSandTexture] = useState(null);
  const [imgStatus, setImgStatus] = useState('正在下载贴图...');
  const textureRef = useRef(null);
  const fileInputRef = useRef(null); // 用于触发本地文件选择

  // 动态解算最终生效的宽高比
  const actualAspect = useMemo(() => {
    if (aspectMode === 'custom') return THREE.MathUtils.clamp(customW / customH, 0.1, 10);
    if (aspectMode === '16/9') return 16 / 9;
    return 4 / 3;
  }, [aspectMode, customW, customH]);

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
    params.set('am', aspectMode);
    if (aspectMode === 'custom') {
      params.set('cw', customW);
      params.set('ch', customH);
    }
    window.history.replaceState(null, '', '?' + params.toString());
  }, [tableWidth, tableLength, posX, posY, posZ, pitch, yaw, fov, aspectMode, customW, customH]);

  // 初始化加载默认服务器图片
  useEffect(() => {
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    const imgPath = import.meta.env.BASE_URL + 'sandtable.jpg';
    loader.load(
      imgPath, 
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        textureRef.current = tex;
        setSandTexture(tex);
        setImgStatus('已加载完成');
      },
      undefined, 
      () => {
        if (!cancelled) setImgStatus('未找到图片(使用纯白底)');
      },
    );
    return () => {
      cancelled = true;
      textureRef.current?.dispose();
      textureRef.current = null;
    };
  }, []);

  // --- 新增：纯前端本地图片上传解析 ---
  const handleLocalImageUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setImgStatus('正在处理本地图片...');
    // 创建一个存在于浏览器内存中的临时 URL
    const blobUrl = URL.createObjectURL(file);
    
    const loader = new THREE.TextureLoader();
    loader.load(
      blobUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        textureRef.current?.dispose();
        textureRef.current = tex;
        setSandTexture(tex);
        setImgStatus('已应用本地图片');
        URL.revokeObjectURL(blobUrl);
        e.target.value = '';
      },
      undefined,
      () => {
        URL.revokeObjectURL(blobUrl);
        setImgStatus('图片读取失败');
        e.target.value = '';
      },
    );
  };

  return (
    <div className="app-shell" style={{ display: 'flex', width: '100vw', height: '100dvh', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      
      {/* 左侧控制面板 */}
      <div className="control-panel" style={{ width: '340px', backgroundColor: '#f5f5f7', borderRight: '1px solid #d2d2d7', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto' }}>
        <div>
          <h2 style={{ margin: '0 0 4px 0', fontSize: '20px', fontWeight: '600', color: '#1d1d1f' }}>AR 视场仿真引擎</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#86868b' }}>
            <span>原点 (0,0) 绑定左下角</span>
            <span style={{ color: imgStatus.includes('已') ? '#34c759' : '#ff9500' }}>{imgStatus}</span>
          </div>
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
             <h3 style={{ margin: 0, fontSize: '14px', color: '#1d1d1f' }}>沙盘物理参数</h3>
             {/* 隐藏的 file input，通过 button 触发 */}
             <input type="file" accept="image/*" ref={fileInputRef} style={{ display: 'none' }} onChange={handleLocalImageUpload} />
             <button 
               onClick={() => fileInputRef.current.click()} 
               style={{ padding: '4px 8px', fontSize: '12px', backgroundColor: '#007AFF', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}
             >
               + 上传图纸
             </button>
          </div>
          <ControlSlider label="宽度 Width (X轴/米)" min={1.0} max={20.0} step={0.1} value={tableWidth} onChange={setTableWidth} />
          <ControlSlider label="长度 Length (Z轴/米)" min={1.0} max={20.0} step={0.1} value={tableLength} onChange={setTableLength} />
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', color: '#1d1d1f' }}>摄像头空间位置</h3>
          <ControlSlider label="X轴位置" min={-2.0} max={tableWidth + 2.0} step={0.01} value={posX} onChange={setPosX} />
          <ControlSlider label="Y轴高度" min={0.1} max={6.0} step={0.01} value={posY} onChange={setPosY} />
          <ControlSlider label="Z轴位置" min={-2.0} max={tableLength + 2.0} step={0.01} value={posZ} onChange={setPosZ} />
        </div>

        <div style={{ backgroundColor: '#fff', padding: '16px', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ margin: 0, fontSize: '14px', color: '#1d1d1f' }}>摄像头参数</h3>
            <select 
              value={aspectMode} onChange={(e) => setAspectMode(e.target.value)}
              style={{ fontSize: '12px', padding: '4px', borderRadius: '6px', border: '1px solid #d2d2d7' }}
            >
              <option value="4/3">4:3 (iPad / 平板)</option>
              <option value="16/9">16:9 (手机 / 宽屏监控)</option>
              <option value="custom">⚙️ 自定义分辨率...</option>
            </select>
          </div>
          
          {/* 当选择自定义模式时，展开自定义宽高输入框 */}
          {aspectMode === 'custom' && (
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', padding: '8px', backgroundColor: '#f5f5f7', borderRadius: '8px' }}>
              <div style={{ flex: 1 }}>
                 <div style={{ fontSize: '11px', color: '#86868b', marginBottom: '4px' }}>画面宽度 (px)</div>
                 <input type="number" value={customW} onChange={(e) => setCustomW(parseFloat(e.target.value)||1920)} style={{ width: '100%', padding: '4px', border: '1px solid #d2d2d7', borderRadius: '4px' }} />
              </div>
              <div style={{ flex: 1 }}>
                 <div style={{ fontSize: '11px', color: '#86868b', marginBottom: '4px' }}>画面高度 (px)</div>
                 <input type="number" value={customH} onChange={(e) => setCustomH(parseFloat(e.target.value)||1080)} style={{ width: '100%', padding: '4px', border: '1px solid #d2d2d7', borderRadius: '4px' }} />
              </div>
            </div>
          )}

          <ControlSlider label="俯仰角 (Pitch)" min={0} max={90} step={1} value={pitch} onChange={setPitch} />
          <ControlSlider label="偏航角 (Yaw)" min={-180} max={180} step={1} value={yaw} onChange={setYaw} />
          <ControlSlider label="有效垂直 FOV" min={45} max={120} step={1} value={fov} onChange={setFov} />
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
            <span>传感器中心距离:</span>
            <span style={{ fontWeight: '500', color: telemetry.centerDistance > 5 ? '#ff3b30' : '#34c759' }}>
              {telemetry.centerDistance.toFixed(2)} m {telemetry.centerDistance > 5 && '(信号衰减)'}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={() => setShowGrid(!showGrid)} style={btnStyle(showGrid)}>网格辅助线</button>
          <button onClick={() => setShowPIP(!showPIP)} style={btnStyle(showPIP)}>PIP 画中画</button>
        </div>
      </div>

      {/* 右侧主 3D 视窗 */}
      <div className="main-view" style={{ flex: 1, position: 'relative', backgroundColor: '#e5e5ea' }}>
        <Canvas
          camera={{ position: [tableWidth/2, Math.max(tableWidth, tableLength) * 0.8, tableLength + 4], fov: 50 }}
          dpr={[1, 2]}
          gl={{ antialias: true, powerPreference: 'high-performance' }}
        >
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
              aspectRatio={actualAspect} tableWidth={tableWidth} tableLength={tableLength} onUpdate={setTelemetry} 
            />
          </group>
        </Canvas>

        {!telemetry.hasFootprint && (
          <div className="projection-warning" role="status">
            视场上沿已越过地平线，地面投影没有有限边界。请调大俯仰角或缩小 FOV。
          </div>
        )}

        {/* 右上角 PIP 动态画中画 */}
        {showPIP && (
          <div className="pip-view" style={{
            position: 'absolute', top: '24px', right: '24px', 
            width: 'min(320px, calc(100% - 48px))',
            aspectRatio: actualAspect,
            backgroundColor: '#000', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.3)', border: '2px solid rgba(255,255,255,0.2)', pointerEvents: 'none', transition: 'aspect-ratio 0.3s ease-out'
          }}>
            <div style={{ position: 'absolute', top: 8, left: 12, zIndex: 10, color: '#fff', fontSize: '12px', fontWeight: 'bold', background: 'rgba(0,0,0,0.5)', padding: '2px 8px', borderRadius: '4px' }}>
              ● 实时取景器
            </div>
            <Canvas camera={{ near: 0.05, far: 500 }} dpr={[1, 1.5]} frameloop="demand">
              <color attach="background" args={['#111827']} />
              <ambientLight intensity={0.5} />
              <directionalLight position={[10, 10, 5]} intensity={1} />
              <PerspectiveCamera
                makeDefault
                position={[posX, posY, posZ]}
                rotation={[-pitch * (Math.PI / 180), -yaw * (Math.PI / 180), 0]}
                rotation-order="YXZ"
                fov={fov}
                near={0.05}
                far={500}
              />
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
  const [draftValue, setDraftValue] = useState(null);
  const inputValue = draftValue ?? value.toFixed(2);

  const commitValue = () => {
    let parsed = parseFloat(inputValue);
    if (isNaN(parsed)) parsed = value;
    if (parsed < min) parsed = min;
    if (parsed > max) parsed = max;
    setDraftValue(null);
    onChange(parsed);
  };

  return (
    <div style={{ marginBottom: '16px' }}>
      <div style={{ fontSize: '12px', color: '#1d1d1f', marginBottom: '6px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <input 
          type="range" min={min} max={max} step={step} value={value} 
          onChange={(e) => { setDraftValue(null); onChange(parseFloat(e.target.value)); }}
          style={{ flex: 1, accentColor: '#007AFF', cursor: 'pointer' }}
        />
        <input 
          type="number" value={inputValue} onChange={(e) => setDraftValue(e.target.value)}
          onBlur={commitValue} onKeyDown={(e) => { if (e.key === 'Enter') commitValue(); }}
          style={{ width: '64px', padding: '4px', fontSize: '12px', fontFamily: 'monospace', border: '1px solid #d2d2d7', borderRadius: '6px', textAlign: 'center' }}
        />
      </div>
    </div>
  );
}
