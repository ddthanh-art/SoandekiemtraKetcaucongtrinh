import React, { useEffect, useRef, useState, useCallback } from 'react';
import { CanvasRenderer } from './utils/canvasRenderer';
import { solve } from './utils/solver';
import { exportToPDF, exportToWord } from './utils/exportUtils';
import type {
  Node, Member, Load, StructureData, SolverResult,
  ToolMode, SupportMode, SupportType, LoadType
} from './types/mechanics';

// ─── Throttle helper (YÊU CẦU 1: chống lag) ─────────────────────────────
function throttle<T extends (...args: any[]) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: any[]) => {
    const now = Date.now();
    if (now - last >= ms) { last = now; fn(...args); }
  }) as T;
}

let nodeCounter = 0;
let memberCounter = 0;
let loadCounter = 0;

function genNodeId() { return String.fromCharCode(65 + (nodeCounter++ % 26)); }
function genMemberId() { return `M${++memberCounter}`; }
function genLoadId() { return `L${++loadCounter}`; }

const DEFAULT_STRUCTURE: StructureData = { nodes: [], members: [], loads: [] };

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const solutionRef = useRef<HTMLDivElement>(null);

  const [structure, setStructure] = useState<StructureData>(DEFAULT_STRUCTURE);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [supportMode, setSupportMode] = useState<SupportMode>('pin');
  const [_loadType, _setLoadType] = useState<LoadType>('point_force');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | undefined>();
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [selectedMemberId, setSelectedMemberId] = useState<string | undefined>();
  const [memberStartNodeId, setMemberStartNodeId] = useState<string | null>(null);
  const [tempLine, setTempLine] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  const [showFBD, setShowFBD] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [examTitle, setExamTitle] = useState('Đề Thi Cơ Học Kết Cấu');
  const [statusMsg, setStatusMsg] = useState('Chào mừng! Chọn công cụ và bắt đầu vẽ mô hình.');

  // Load form state
  const [loadMagnitude, setLoadMagnitude] = useState(10);
  const [loadAngle, setLoadAngle] = useState(270);
  const [loadPosition, setLoadPosition] = useState(0.5);
  const [loadPositionEnd, setLoadPositionEnd] = useState(1.0);



  // ─── Init Canvas ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;

    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;

    const handleResize = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
      renderer.setOffset(canvas.width / 2, canvas.height / 2);
      renderer.markDirty();
    };
    window.addEventListener('resize', handleResize);

    return () => {
      renderer.destroy();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  // ─── Sync data + options to renderer ─────────────────────────────────
  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.setData(structure);
  }, [structure]);

  useEffect(() => {
    if (!rendererRef.current) return;
    rendererRef.current.setOptions({
      hoveredNodeId,
      selectedNodeId,
      selectedMemberId,
      tempLine,
      showFBD,
      reactions: solverResult?.reactions,
    });
  }, [hoveredNodeId, selectedNodeId, selectedMemberId, tempLine, showFBD, solverResult]);

  // ─── Mouse handlers với Throttle (YÊU CẦU 1) ─────────────────────────
  const handleMouseMove = useCallback(
    throttle((e: React.MouseEvent<HTMLCanvasElement>) => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const rect = canvasRef.current!.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      const nearest = renderer.findNearestNode(cx, cy, 20);
      setHoveredNodeId(nearest?.id);

      if (toolMode === 'add_member' && memberStartNodeId) {
        const startNode = structure.nodes.find(n => n.id === memberStartNodeId);
        if (startNode) {
          const sp = renderer.worldToCanvas(startNode.worldX, startNode.worldY);
          const snapped = renderer.snapToGrid(cx, cy);
          const snapCanvas = renderer.worldToCanvas(snapped.worldX, snapped.worldY);
          setTempLine({ x1: sp.x, y1: sp.y, x2: snapCanvas.x, y2: snapCanvas.y });
        }
      }
    }, 16), // ~60fps throttle
    [toolMode, memberStartNodeId, structure.nodes]
  );

  const handleMouseLeave = useCallback(() => {
    setHoveredNodeId(undefined);
    setTempLine(null);
  }, []);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (toolMode === 'select') {
      const nearNode = renderer.findNearestNode(cx, cy, 20);
      const nearMember = renderer.findNearestMember(cx, cy, 12);
      setSelectedNodeId(nearNode?.id);
      setSelectedMemberId(nearNode ? undefined : nearMember?.id);
      if (nearNode) setStatusMsg(`Đã chọn nút ${nearNode.id} (${nearNode.worldX.toFixed(1)}, ${nearNode.worldY.toFixed(1)}) m`);
      else if (nearMember) setStatusMsg(`Đã chọn thanh ${nearMember.id} | L=${nearMember.length.toFixed(2)}m`);
      else setStatusMsg('Không có phần tử nào được chọn.');
      return;
    }

    if (toolMode === 'add_node') {
      const snapped = renderer.snapToGrid(cx, cy);
      const existingNode = renderer.findNearestNode(cx, cy, 15);
      if (existingNode) {
        setStatusMsg(`Đã có nút tại vị trí này (${existingNode.id})`);
        return;
      }
      const newNode: Node = {
        id: genNodeId(),
        x: cx, y: cy,
        worldX: snapped.worldX,
        worldY: snapped.worldY,
      };
      setStructure(prev => ({ ...prev, nodes: [...prev.nodes, newNode] }));
      setStatusMsg(`✅ Đã thêm nút ${newNode.id} tại (${newNode.worldX}, ${newNode.worldY}) m`);
      return;
    }

    if (toolMode === 'add_member') {
      const nearNode = renderer.findNearestNode(cx, cy, 25);
      if (!nearNode) {
        setStatusMsg('⚠️ Click vào nút để bắt đầu/kết thúc thanh.');
        return;
      }
      if (!memberStartNodeId) {
        setMemberStartNodeId(nearNode.id);
        setStatusMsg(`Đã chọn nút bắt đầu: ${nearNode.id}. Click nút tiếp theo để tạo thanh.`);
      } else {
        if (nearNode.id === memberStartNodeId) {
          setMemberStartNodeId(null);
          setTempLine(null);
          setStatusMsg('Huỷ tạo thanh (chọn lại nút bắt đầu).');
          return;
        }
        const startNode = structure.nodes.find(n => n.id === memberStartNodeId)!;
        const dx = nearNode.worldX - startNode.worldX;
        const dy = nearNode.worldY - startNode.worldY;
        const length = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);

        const newMember: Member = {
          id: genMemberId(),
          startNodeId: memberStartNodeId,
          endNodeId: nearNode.id,
          length: parseFloat(length.toFixed(3)),
          angle: parseFloat(angle.toFixed(2)),
          label: `${memberStartNodeId}${nearNode.id}`,
        };
        setStructure(prev => ({ ...prev, members: [...prev.members, newMember] }));
        setMemberStartNodeId(null);
        setTempLine(null);
        setStatusMsg(`✅ Đã tạo thanh ${newMember.label} | L=${newMember.length.toFixed(2)}m, α=${newMember.angle.toFixed(1)}°`);
      }
      return;
    }

    if (toolMode === 'add_support') {
      const nearNode = renderer.findNearestNode(cx, cy, 25);
      if (!nearNode) { setStatusMsg('⚠️ Click vào nút để gán liên kết.'); return; }
      setStructure(prev => ({
        ...prev,
        nodes: prev.nodes.map(n =>
          n.id === nearNode.id
            ? { ...n, support: supportMode as SupportType }
            : n
        )
      }));
      const supportLabel = { fixed: 'Ngàm cố định', pin: 'Gối cố định (khớp)', roller: 'Gối di động', internal_hinge: 'Khớp nội' }[supportMode];
      setStatusMsg(`✅ Đã gán ${supportLabel} vào nút ${nearNode.id}`);
      return;
    }

    if (toolMode === 'add_load' || toolMode === 'add_distributed' || toolMode === 'add_moment') {
      const actualLoadType: LoadType = toolMode === 'add_load'
        ? 'point_force'
        : toolMode === 'add_distributed'
          ? 'distributed'
          : 'moment';

      if (actualLoadType === 'point_force' || actualLoadType === 'moment') {
        const nearNode = renderer.findNearestNode(cx, cy, 25);
        const nearMember = renderer.findNearestMember(cx, cy, 15);

        if (!nearNode && !nearMember) {
          setStatusMsg('⚠️ Click vào nút hoặc thanh để gán tải trọng.');
          return;
        }

        const newLoad: Load = {
          id: genLoadId(),
          type: actualLoadType,
          nodeId: nearNode?.id,
          memberId: nearNode ? undefined : nearMember?.id,
          magnitude: loadMagnitude,
          angle: loadAngle,
          position: nearNode ? 0 : loadPosition,
        };
        setStructure(prev => ({ ...prev, loads: [...prev.loads, newLoad] }));
        setStatusMsg(`✅ Đã gán ${actualLoadType === 'point_force' ? 'lực tập trung' : 'momen'} ${loadMagnitude} kN${actualLoadType === 'moment' ? '·m' : ''}`);

      } else if (actualLoadType === 'distributed') {
        const nearMember = renderer.findNearestMember(cx, cy, 15);
        if (!nearMember) {
          setStatusMsg('⚠️ Click vào thanh để gán tải phân bố.');
          return;
        }
        const newLoad: Load = {
          id: genLoadId(),
          type: 'distributed',
          memberId: nearMember.id,
          magnitude: loadMagnitude,
          angle: loadAngle,
          position: loadPosition,
          positionEnd: loadPositionEnd,
        };
        setStructure(prev => ({ ...prev, loads: [...prev.loads, newLoad] }));
        setStatusMsg(`✅ Đã gán tải phân bố q=${loadMagnitude} kN/m lên thanh ${nearMember.id}`);
      }
      return;
    }
  }, [toolMode, supportMode, memberStartNodeId, structure.nodes, loadMagnitude, loadAngle, loadPosition, loadPositionEnd]);

  // ─── Solve ────────────────────────────────────────────────────────────
  const handleSolve = useCallback(() => {
    if (structure.nodes.length === 0) {
      setStatusMsg('⚠️ Chưa có nút nào trong mô hình!');
      return;
    }
    const result = solve(structure);
    setSolverResult(result);
    setShowFBD(true);
    setStatusMsg(
      result.isStaticallyDeterminate
        ? '✅ Giải thành công! Kết quả phản lực đã hiển thị.'
        : `⚠️ Không thể giải (bậc siêu tĩnh = ${result.degreeOfIndeterminacy})`
    );

    // Render KaTeX sau khi DOM cập nhật
    setTimeout(() => {
      if (typeof (window as any).renderMathInElement === 'function' && solutionRef.current) {
        (window as any).renderMathInElement(solutionRef.current, {
          delimiters: [
            { left: '$$', right: '$$', display: true },
            { left: '$', left2: '\\(', right: '\\)', display: false },
            { left: '\\[', right: '\\]', display: true },
          ],
          throwOnError: false,
        });
      }
    }, 200);
  }, [structure]);

  // ─── Clear ────────────────────────────────────────────────────────────
  const handleClear = useCallback(() => {
    if (!confirm('Bạn có chắc muốn xoá toàn bộ mô hình?')) return;
    nodeCounter = 0; memberCounter = 0; loadCounter = 0;
    setStructure(DEFAULT_STRUCTURE);
    setSolverResult(null);
    setShowFBD(false);
    setMemberStartNodeId(null);
    setTempLine(null);
    setSelectedNodeId(undefined);
    setSelectedMemberId(undefined);
    setStatusMsg('Đã xoá mô hình. Bắt đầu lại từ đầu.');
  }, []);

  // ─── Delete selected ──────────────────────────────────────────────────
  const handleDeleteSelected = useCallback(() => {
    if (selectedNodeId) {
      setStructure(prev => ({
        nodes: prev.nodes.filter(n => n.id !== selectedNodeId),
        members: prev.members.filter(m => m.startNodeId !== selectedNodeId && m.endNodeId !== selectedNodeId),
        loads: prev.loads.filter(l => l.nodeId !== selectedNodeId),
      }));
      setSelectedNodeId(undefined);
      setStatusMsg(`Đã xoá nút ${selectedNodeId}`);
    } else if (selectedMemberId) {
      setStructure(prev => ({
        ...prev,
        members: prev.members.filter(m => m.id !== selectedMemberId),
        loads: prev.loads.filter(l => l.memberId !== selectedMemberId),
      }));
      setSelectedMemberId(undefined);
      setStatusMsg(`Đã xoá thanh ${selectedMemberId}`);
    }
  }, [selectedNodeId, selectedMemberId]);

  // ─── Export PDF (YÊU CẦU 2) ──────────────────────────────────────────
  const handleExportPDF = useCallback(async () => {
    if (!rendererRef.current) return;
    setIsExporting(true);
    setStatusMsg('⏳ Đang xuất PDF...');
    try {
      await exportToPDF({
        title: examTitle,
        canvasDataUrl: rendererRef.current.toDataURL(),
        solutionHtmlElement: solutionRef.current,
        structureInfo: {
          nodeCount: structure.nodes.length,
          memberCount: structure.members.length,
          loadCount: structure.loads.length,
          isStaticDeterminate: solverResult?.isStaticallyDeterminate ?? false,
          doi: solverResult?.degreeOfIndeterminacy ?? 0,
        },
        steps: solverResult?.steps ?? [],
      });
      setStatusMsg('✅ Đã xuất PDF thành công!');
    } catch (err) {
      console.error(err);
      setStatusMsg('❌ Lỗi khi xuất PDF. Xem console để biết chi tiết.');
    } finally {
      setIsExporting(false);
    }
  }, [examTitle, structure, solverResult]);

  // ─── Export Word (YÊU CẦU 3) ─────────────────────────────────────────
  const handleExportWord = useCallback(async () => {
    if (!rendererRef.current) return;
    setIsExporting(true);
    setStatusMsg('⏳ Đang xuất file Word...');
    try {
      await exportToWord({
        title: examTitle,
        canvasDataUrl: rendererRef.current.toDataURL(),
        solutionHtmlElement: solutionRef.current,
        structureInfo: {
          nodeCount: structure.nodes.length,
          memberCount: structure.members.length,
          loadCount: structure.loads.length,
          isStaticDeterminate: solverResult?.isStaticallyDeterminate ?? false,
          doi: solverResult?.degreeOfIndeterminacy ?? 0,
        },
        steps: solverResult?.steps ?? [],
      });
      setStatusMsg('✅ Đã xuất file Word thành công!');
    } catch (err) {
      console.error(err);
      setStatusMsg('❌ Lỗi khi xuất Word. Xem console để biết chi tiết.');
    } finally {
      setIsExporting(false);
    }
  }, [examTitle, structure, solverResult]);

  // ─── Keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      switch (e.key.toLowerCase()) {
        case 's': setToolMode('select'); break;
        case 'n': setToolMode('add_node'); break;
        case 'm': setToolMode('add_member'); setMemberStartNodeId(null); setTempLine(null); break;
        case 'l': setToolMode('add_support'); break;
        case 'p': setToolMode('add_load'); break;
        case 'q': setToolMode('add_distributed'); break;
        case 'delete':
        case 'backspace': handleDeleteSelected(); break;
        case 'enter': handleSolve(); break;
        case 'escape': setMemberStartNodeId(null); setTempLine(null); setToolMode('select'); break;
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleDeleteSelected, handleSolve]);

  // ─── Load sample ──────────────────────────────────────────────────────
  const handleLoadSample = useCallback(() => {
    nodeCounter = 0; memberCounter = 0; loadCounter = 0;
    const A: Node = { id: 'A', x: 0, y: 0, worldX: 0, worldY: 0, support: 'pin' };
    const B: Node = { id: 'B', x: 0, y: 0, worldX: 4, worldY: 0 };
    const C: Node = { id: 'C', x: 0, y: 0, worldX: 8, worldY: 0, support: 'roller' };
    nodeCounter = 3;

    const mAB: Member = { id: 'M1', startNodeId: 'A', endNodeId: 'B', length: 4, angle: 0, label: 'AB' };
    const mBC: Member = { id: 'M2', startNodeId: 'B', endNodeId: 'C', length: 4, angle: 0, label: 'BC' };
    memberCounter = 2;

    const load1: Load = {
      id: 'L1', type: 'point_force',
      nodeId: 'B', memberId: undefined,
      magnitude: 20, angle: 270, position: 0,
    };
    const load2: Load = {
      id: 'L2', type: 'distributed',
      memberId: 'M1',
      magnitude: 10, angle: 270, position: 0, positionEnd: 1,
    };
    loadCounter = 2;

    setStructure({ nodes: [A, B, C], members: [mAB, mBC], loads: [load1, load2] });
    setSolverResult(null);
    setShowFBD(false);
    setStatusMsg('✅ Đã tải mô hình mẫu: Dầm AB-BC, P=20kN tại B, q=10kN/m trên AB');
  }, []);

  // ─── Format step content ──────────────────────────────────────────────
  const formatStep = (step: string, index: number) => {
    if (step.startsWith('## ')) {
      return (
        <h3 key={index} className="text-base font-bold text-blue-800 mt-4 mb-2 flex items-center gap-1">
          {step.replace(/^##\s*/, '')}
        </h3>
      );
    }
    if (step === '---') {
      return <hr key={index} className="border-blue-200 my-3" />;
    }
    if (step.startsWith('- ')) {
      const content = step.replace(/^-\s*/, '');
      return (
        <div key={index} className="flex items-start gap-2 text-sm text-slate-700 py-0.5">
          <span className="text-blue-400 mt-0.5 flex-shrink-0">•</span>
          <span dangerouslySetInnerHTML={{ __html: renderInlineMath(content) }} />
        </div>
      );
    }
    if (step.includes('**')) {
      return (
        <p key={index}
          className="text-sm text-slate-800 py-0.5"
          dangerouslySetInnerHTML={{ __html: renderBold(step) }}
        />
      );
    }
    if (step.includes('\\sum') || step.includes('\\quad') || step.includes('\\cdot')) {
      return (
        <div key={index} className="bg-blue-50 border-l-4 border-blue-400 px-3 py-2 my-1 rounded-r text-sm font-mono">
          <span dangerouslySetInnerHTML={{ __html: renderMathBlock(step) }} />
        </div>
      );
    }
    return (
      <p key={index} className="text-sm text-slate-700 py-0.5">{step}</p>
    );
  };

  const renderInlineMath = (text: string) => {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  };
  const renderBold = (text: string) => {
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  };
  const renderMathBlock = (text: string) => {
    return `<code>${text}</code>`;
  };

  // ─── Tool button class ────────────────────────────────────────────────
  const toolBtnClass = (mode: ToolMode) =>
    `flex flex-col items-center gap-1 p-2 rounded-lg border-2 text-xs font-medium transition-all cursor-pointer select-none ${
      toolMode === mode
        ? 'border-blue-600 bg-blue-600 text-white shadow-md scale-105'
        : 'border-blue-200 bg-white text-blue-700 hover:border-blue-400 hover:bg-blue-50'
    }`;

  const supportBtnClass = (mode: SupportMode) =>
    `px-2 py-1 rounded text-xs font-medium border transition-all cursor-pointer ${
      supportMode === mode
        ? 'border-red-500 bg-red-500 text-white'
        : 'border-slate-300 bg-white text-slate-600 hover:border-red-300'
    }`;

  return (
    <div className="min-h-screen bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 font-inter flex flex-col">
      {/* ── Header ── */}
      <header className="bg-gradient-to-r from-blue-800 to-blue-600 text-white shadow-lg px-4 py-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center text-2xl">🏗️</div>
          <div>
            <h1 className="text-lg font-bold leading-tight">Ứng Dụng Tạo Đề Thi Cơ Học / Kết Cấu</h1>
            <p className="text-blue-200 text-xs">Static HTML | Client-side JavaScript Engine</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={examTitle}
            onChange={e => setExamTitle(e.target.value)}
            className="bg-white/20 text-white placeholder-blue-200 border border-white/30 rounded-lg px-3 py-1.5 text-sm w-56 focus:outline-none focus:ring-2 focus:ring-white/50"
            placeholder="Tên đề thi..."
          />
          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="flex items-center gap-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow"
          >
            📄 {isExporting ? 'Đang xuất...' : 'Xuất PDF'}
          </button>
          <button
            onClick={handleExportWord}
            disabled={isExporting}
            className="flex items-center gap-1.5 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow"
          >
            📝 Xuất Word
          </button>
        </div>
      </header>

      {/* ── Status bar ── */}
      <div className="bg-white border-b border-blue-100 px-4 py-2 text-sm text-slate-600 flex items-center gap-2 flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0"></span>
        {statusMsg}
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* ── LEFT: Toolbox ── */}
        <aside className="w-56 bg-white border-r border-blue-100 flex flex-col overflow-y-auto flex-shrink-0 shadow-sm">
          <div className="p-3">
            {/* Công cụ vẽ */}
            <div className="mb-4">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Công Cụ Vẽ</h2>
              <div className="grid grid-cols-2 gap-1.5">
                <button className={toolBtnClass('select')} onClick={() => setToolMode('select')}>
                  <span className="text-lg">↖️</span> Chọn
                </button>
                <button className={toolBtnClass('add_node')} onClick={() => setToolMode('add_node')}>
                  <span className="text-lg">📍</span> Thêm nút
                </button>
                <button className={toolBtnClass('add_member')} onClick={() => { setToolMode('add_member'); setMemberStartNodeId(null); setTempLine(null); }}>
                  <span className="text-lg">📏</span> Thêm thanh
                </button>
                <button className={toolBtnClass('add_support')} onClick={() => setToolMode('add_support')}>
                  <span className="text-lg">🔩</span> Liên kết
                </button>
                <button className={toolBtnClass('add_load')} onClick={() => setToolMode('add_load')}>
                  <span className="text-lg">⬇️</span> Lực P
                </button>
                <button className={toolBtnClass('add_distributed')} onClick={() => setToolMode('add_distributed')}>
                  <span className="text-lg">🌧️</span> Tải q
                </button>
                <button className={toolBtnClass('add_moment')} onClick={() => setToolMode('add_moment')}>
                  <span className="text-lg">🔄</span> Momen M
                </button>
              </div>
            </div>

            {/* Loại liên kết */}
            {toolMode === 'add_support' && (
              <div className="mb-4 p-2 bg-red-50 rounded-xl border border-red-100">
                <h3 className="text-xs font-bold text-red-600 mb-2">Loại Liên Kết</h3>
                <div className="flex flex-col gap-1">
                  {([
                    ['fixed', '🏛️ Ngàm cố định'],
                    ['pin', '📌 Gối cố định (khớp)'],
                    ['roller', '🎯 Gối di động'],
                    ['internal_hinge', '🔗 Khớp nội'],
                  ] as [SupportMode, string][]).map(([mode, label]) => (
                    <button
                      key={mode}
                      className={supportBtnClass(mode)}
                      onClick={() => setSupportMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Thông số tải trọng */}
            {(toolMode === 'add_load' || toolMode === 'add_distributed' || toolMode === 'add_moment') && (
              <div className="mb-4 p-2 bg-purple-50 rounded-xl border border-purple-100">
                <h3 className="text-xs font-bold text-purple-600 mb-2">Thông Số Tải Trọng</h3>
                <label className="block text-xs text-slate-600 mb-1">
                  {toolMode === 'add_moment' ? 'Momen M (kN·m)' : toolMode === 'add_distributed' ? 'Cường độ q (kN/m)' : 'Lực P (kN)'}
                </label>
                <input
                  type="number"
                  value={loadMagnitude}
                  onChange={e => setLoadMagnitude(parseFloat(e.target.value) || 0)}
                  className="w-full border border-purple-200 rounded px-2 py-1 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
                {toolMode !== 'add_moment' && (
                  <>
                    <label className="block text-xs text-slate-600 mb-1">Góc tác dụng α (°)</label>
                    <input
                      type="number"
                      value={loadAngle}
                      onChange={e => setLoadAngle(parseFloat(e.target.value) || 0)}
                      className="w-full border border-purple-200 rounded px-2 py-1 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    <div className="flex gap-1 mb-2">
                      {[[270, '⬇️ Xuống'], [90, '⬆️ Lên'], [0, '➡️ Phải'], [180, '⬅️ Trái']].map(([angle, label]) => (
                        <button
                          key={angle}
                          onClick={() => setLoadAngle(Number(angle))}
                          className={`flex-1 text-xs py-1 rounded border transition-all ${loadAngle === Number(angle) ? 'bg-purple-500 text-white border-purple-500' : 'bg-white text-slate-600 border-slate-200 hover:border-purple-300'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {toolMode === 'add_distributed' && (
                  <>
                    <label className="block text-xs text-slate-600 mb-1">Vị trí đầu (0→1)</label>
                    <input
                      type="number" min={0} max={1} step={0.1}
                      value={loadPosition}
                      onChange={e => setLoadPosition(parseFloat(e.target.value))}
                      className="w-full border border-purple-200 rounded px-2 py-1 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                    <label className="block text-xs text-slate-600 mb-1">Vị trí cuối (0→1)</label>
                    <input
                      type="number" min={0} max={1} step={0.1}
                      value={loadPositionEnd}
                      onChange={e => setLoadPositionEnd(parseFloat(e.target.value))}
                      className="w-full border border-purple-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </>
                )}
                {toolMode === 'add_load' && (
                  <>
                    <label className="block text-xs text-slate-600 mb-1">Vị trí trên thanh (0→1)</label>
                    <input
                      type="number" min={0} max={1} step={0.1}
                      value={loadPosition}
                      onChange={e => setLoadPosition(parseFloat(e.target.value))}
                      className="w-full border border-purple-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                    />
                  </>
                )}
              </div>
            )}

            {/* Actions */}
            <div className="mb-4">
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Hành Động</h2>
              <div className="flex flex-col gap-1.5">
                <button
                  onClick={handleSolve}
                  className="flex items-center justify-center gap-2 bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white py-2 px-3 rounded-lg text-sm font-bold transition-all shadow-md"
                >
                  ⚡ GIẢI BÀI TOÁN
                </button>
                <button
                  onClick={() => setShowFBD(p => !p)}
                  className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all border-2 ${
                    showFBD ? 'bg-emerald-100 border-emerald-400 text-emerald-700' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'
                  }`}
                >
                  🔍 {showFBD ? 'Ẩn FBD' : 'Hiện FBD'}
                </button>
                <button
                  onClick={handleLoadSample}
                  className="flex items-center justify-center gap-2 bg-amber-50 hover:bg-amber-100 text-amber-700 border-2 border-amber-200 hover:border-amber-400 py-2 px-3 rounded-lg text-sm font-medium transition-all"
                >
                  📚 Mô Hình Mẫu
                </button>
                {(selectedNodeId || selectedMemberId) && (
                  <button
                    onClick={handleDeleteSelected}
                    className="flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 border-2 border-red-200 hover:border-red-400 py-2 px-3 rounded-lg text-sm font-medium transition-all"
                  >
                    🗑️ Xoá đã chọn
                  </button>
                )}
                <button
                  onClick={handleClear}
                  className="flex items-center justify-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-600 border-2 border-slate-200 py-2 px-3 rounded-lg text-sm font-medium transition-all"
                >
                  🧹 Xoá Tất Cả
                </button>
              </div>
            </div>

            {/* Info panel */}
            <div className="bg-blue-50 rounded-xl p-3 border border-blue-100">
              <h3 className="text-xs font-bold text-blue-700 mb-2">📊 Thống Kê Mô Hình</h3>
              <div className="space-y-1 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Số nút:</span>
                  <span className="font-bold text-blue-700">{structure.nodes.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Số thanh:</span>
                  <span className="font-bold text-blue-700">{structure.members.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tải trọng:</span>
                  <span className="font-bold text-purple-700">{structure.loads.length}</span>
                </div>
                <div className="flex justify-between">
                  <span>Phản lực (r):</span>
                  <span className="font-bold text-green-700">
                    {structure.nodes.reduce((s, n) =>
                      s + (n.support === 'fixed' ? 3 : n.support === 'pin' ? 2 : n.support === 'roller' ? 1 : 0), 0
                    )}
                  </span>
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="mt-3 bg-slate-50 rounded-xl p-3 border border-slate-100">
              <h3 className="text-xs font-bold text-slate-500 mb-2">Chú Giải</h3>
              <div className="space-y-1 text-xs">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-white border-2 border-blue-500"></div>
                  <span>Nút tự do</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <span>Nút có liên kết</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-6 h-1 bg-blue-500 rounded"></div>
                  <span>Thanh kết cấu</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-green-500"></div>
                  <span>Phản lực (FBD)</span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* ── CENTER: Canvas ── */}
        <main className="flex-1 flex flex-col min-w-0">
          <div
            className="relative flex-1 overflow-hidden"
            style={{ cursor: toolMode === 'select' ? 'default' : 'crosshair' }}
          >
            <canvas
              ref={canvasRef}
              className="w-full h-full block"
              onClick={handleCanvasClick}
              onMouseMove={handleMouseMove}
              onMouseLeave={handleMouseLeave}
            />

            {/* Tool indicator overlay */}
            <div className="absolute top-3 left-3 bg-white/90 backdrop-blur-sm border border-blue-200 rounded-lg px-3 py-1.5 text-xs font-medium text-blue-700 shadow-sm">
              🛠️ Công cụ: {
                { select: 'Chọn/Di chuyển', add_node: 'Thêm nút', add_member: 'Thêm thanh', add_support: 'Gán liên kết', add_load: 'Gán lực tập trung', add_distributed: 'Gán tải phân bố', add_moment: 'Gán momen' }[toolMode]
              }
              {toolMode === 'add_member' && memberStartNodeId && (
                <span className="ml-2 text-green-600">| Nút bắt đầu: {memberStartNodeId}</span>
              )}
            </div>

            {/* Grid toggle */}
            <div className="absolute top-3 right-3 flex gap-2">
              <button
                className="bg-white/90 backdrop-blur-sm border border-blue-200 rounded-lg px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 transition-all shadow-sm"
                onClick={() => rendererRef.current?.setOptions({ showGrid: true })}
              >
                Grid ON
              </button>
              <button
                className="bg-white/90 backdrop-blur-sm border border-blue-200 rounded-lg px-2 py-1 text-xs text-blue-700 hover:bg-blue-50 transition-all shadow-sm"
                onClick={() => rendererRef.current?.setOptions({ showGrid: false })}
              >
                Grid OFF
              </button>
            </div>

            {/* Coordinate display */}
            <div className="absolute bottom-3 left-3 bg-white/80 backdrop-blur-sm border border-blue-100 rounded-lg px-2 py-1 text-xs text-slate-500 shadow-sm">
              🎯 Click để đặt nút | Snap: 0.5m | Tỉ lệ: 60px/m
            </div>
          </div>
        </main>

        {/* ── RIGHT: Solution panel ── */}
        <aside className="w-96 bg-white border-l border-blue-100 flex flex-col overflow-hidden flex-shrink-0 shadow-sm">
          <div className="bg-gradient-to-r from-blue-700 to-blue-600 text-white px-4 py-3 flex-shrink-0">
            <h2 className="font-bold text-sm">📝 Lời Giải Chi Tiết</h2>
            <p className="text-blue-200 text-xs">Nhấn "GIẢI BÀI TOÁN" để xem kết quả</p>
          </div>

          <div
            ref={solutionRef}
            className="flex-1 overflow-y-auto p-4 space-y-1 text-sm"
          >
            {!solverResult ? (
              <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
                <div className="text-5xl opacity-30">🔧</div>
                <div className="text-slate-400">
                  <p className="font-medium mb-1">Chưa có kết quả</p>
                  <p className="text-xs">Vẽ mô hình và nhấn<br />"⚡ GIẢI BÀI TOÁN"</p>
                </div>
              </div>
            ) : (
              <>
                {/* Kết quả phản lực */}
                {solverResult.isStaticallyDeterminate && solverResult.reactions.length > 0 && (
                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 border border-green-200 rounded-xl p-4 mb-4">
                    <h3 className="font-bold text-green-800 text-base mb-3 flex items-center gap-2">
                      ✅ Kết Quả Phản Lực
                    </h3>
                    <div className="space-y-2">
                      {solverResult.reactions.map(r => (
                        <div key={r.nodeId} className="bg-white rounded-lg p-3 border border-green-100 shadow-sm">
                          <div className="font-bold text-green-700 text-sm mb-1">Nút {r.nodeId}:</div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            {r.Hx !== undefined && (
                              <div className="bg-blue-50 rounded p-1 text-center">
                                <div className="text-blue-500 font-medium">Hₓ</div>
                                <div className="font-bold text-blue-800">{r.Hx.toFixed(3)}</div>
                                <div className="text-slate-400">kN</div>
                              </div>
                            )}
                            {r.Vy !== undefined && (
                              <div className="bg-purple-50 rounded p-1 text-center">
                                <div className="text-purple-500 font-medium">Vy</div>
                                <div className="font-bold text-purple-800">{r.Vy.toFixed(3)}</div>
                                <div className="text-slate-400">kN</div>
                              </div>
                            )}
                            {r.M !== undefined && (
                              <div className="bg-orange-50 rounded p-1 text-center">
                                <div className="text-orange-500 font-medium">M</div>
                                <div className="font-bold text-orange-800">{r.M.toFixed(3)}</div>
                                <div className="text-slate-400">kN·m</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Kiểm tra */}
                    <div className="mt-3 grid grid-cols-3 gap-1 text-xs">
                      <div className={`rounded p-1 text-center ${Math.abs(solverResult.sumFx) < 1e-6 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        ΣFx≈0 {Math.abs(solverResult.sumFx) < 1e-6 ? '✅' : '❌'}
                      </div>
                      <div className={`rounded p-1 text-center ${Math.abs(solverResult.sumFy) < 1e-6 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        ΣFy≈0 {Math.abs(solverResult.sumFy) < 1e-6 ? '✅' : '❌'}
                      </div>
                      <div className={`rounded p-1 text-center ${Math.abs(solverResult.sumM) < 1e-6 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        ΣM≈0 {Math.abs(solverResult.sumM) < 1e-6 ? '✅' : '❌'}
                      </div>
                    </div>
                  </div>
                )}

                {/* Chi tiết các bước */}
                <div className="space-y-0.5">
                  {solverResult.steps.map((step, i) => formatStep(step, i))}
                </div>
              </>
            )}
          </div>

          {/* Solution footer */}
          {solverResult && (
            <div className="border-t border-blue-100 px-4 py-3 bg-blue-50 flex-shrink-0">
              <div className="flex gap-2">
                <button
                  onClick={handleExportPDF}
                  disabled={isExporting}
                  className="flex-1 flex items-center justify-center gap-1 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-medium transition-all"
                >
                  📄 Xuất PDF
                </button>
                <button
                  onClick={handleExportWord}
                  disabled={isExporting}
                  className="flex-1 flex items-center justify-center gap-1 bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 text-white py-2 rounded-lg text-xs font-medium transition-all"
                >
                  📝 Xuất Word
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* ── Keyboard shortcut hint ── */}
      <div className="bg-white border-t border-blue-100 px-4 py-1.5 text-xs text-slate-400 flex items-center gap-4 flex-shrink-0">
        <span>⌨️ Phím tắt:</span>
        <span>[S] Chọn</span>
        <span>[N] Thêm nút</span>
        <span>[M] Thêm thanh</span>
        <span>[L] Thêm liên kết</span>
        <span>[P] Thêm lực</span>
        <span>[Q] Tải phân bố</span>
        <span>[Del] Xoá</span>
        <span>[Enter] Giải</span>
      </div>
    </div>
  );
}
