/**
 * canvasRenderer.ts
 * Tối ưu hiệu năng Canvas với requestAnimationFrame
 * Chống flickering/lag khi vẽ mô hình cơ học
 */

import type { StructureData, Node, Member, Load, Reaction } from '../types/mechanics';

const GRID_SIZE = 40; // px per unit
const NODE_RADIUS = 8;
const SCALE = 60; // pixels per meter

export interface RenderOptions {
  showGrid: boolean;
  showFBD: boolean;        // Show Free Body Diagram (phản lực)
  showDimensions: boolean;
  hoveredNodeId?: string;
  selectedNodeId?: string;
  selectedMemberId?: string;
  tempLine?: { x1: number; y1: number; x2: number; y2: number } | null;
  reactions?: Reaction[];
}

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rafId: number | null = null;
  private isDirty: boolean = false;
  private data: StructureData = { nodes: [], members: [], loads: [] };
  private options: RenderOptions = { showGrid: true, showFBD: false, showDimensions: true };
  private offsetX: number = 50;
  private offsetY: number = 50;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.offsetX = canvas.width / 2;
    this.offsetY = canvas.height / 2;
    this.startRenderLoop();
  }

  /** Chuyển world coords (m) → canvas pixel */
  worldToCanvas(wx: number, wy: number): { x: number; y: number } {
    return {
      x: this.offsetX + wx * SCALE,
      y: this.offsetY - wy * SCALE  // Y flipped (screen Y down, world Y up)
    };
  }

  /** Chuyển canvas pixel → world coords (m) */
  canvasToWorld(cx: number, cy: number): { x: number; y: number } {
    return {
      x: (cx - this.offsetX) / SCALE,
      y: (this.offsetY - cy) / SCALE
    };
  }

  setData(data: StructureData) {
    this.data = data;
    this.markDirty();
  }

  setOptions(opts: Partial<RenderOptions>) {
    this.options = { ...this.options, ...opts };
    this.markDirty();
  }

  setOffset(x: number, y: number) {
    this.offsetX = x;
    this.offsetY = y;
    this.markDirty();
  }

  markDirty() {
    this.isDirty = true;
  }

  /** Render loop sử dụng requestAnimationFrame – tránh flickering */
  private startRenderLoop() {
    const loop = () => {
      if (this.isDirty) {
        this.render();
        this.isDirty = false;
      }
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  destroy() {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
  }

  private render() {
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Xóa toàn bộ canvas trước khi vẽ frame mới
    ctx.clearRect(0, 0, w, h);

    // Nền trắng ngà
    ctx.fillStyle = '#FAFCFF';
    ctx.fillRect(0, 0, w, h);

    if (this.options.showGrid) this.drawGrid(w, h);
    this.drawAxes(w, h);
    this.drawMembers();
    this.drawLoads();
    this.drawNodes();
    if (this.options.showFBD && this.options.reactions) {
      this.drawReactions(this.options.reactions);
    }
    if (this.options.tempLine) this.drawTempLine(this.options.tempLine);
    if (this.options.showDimensions) this.drawDimensions();
  }

  private drawGrid(w: number, h: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#E0EDF7';
    ctx.lineWidth = 0.8;

    const startX = this.offsetX % GRID_SIZE;
    const startY = this.offsetY % GRID_SIZE;

    // Vertical lines
    for (let x = startX; x < w; x += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
    // Horizontal lines
    for (let y = startY; y < h; y += GRID_SIZE) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawAxes(w: number, h: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#B0C4DE';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 3]);

    // X axis
    ctx.beginPath();
    ctx.moveTo(0, this.offsetY);
    ctx.lineTo(w, this.offsetY);
    ctx.stroke();

    // Y axis
    ctx.beginPath();
    ctx.moveTo(this.offsetX, 0);
    ctx.lineTo(this.offsetX, h);
    ctx.stroke();

    ctx.restore();

    // Labels
    ctx.fillStyle = '#90A4AE';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('x (m)', w - 30, this.offsetY - 5);
    ctx.fillText('y (m)', this.offsetX + 5, 15);

    // Scale markers every 1m
    ctx.fillStyle = '#78909C';
    ctx.font = '9px Inter, sans-serif';
    for (let i = -10; i <= 10; i++) {
      if (i === 0) continue;
      const px = this.offsetX + i * SCALE;
      const py = this.offsetY + i * SCALE;
      if (px > 0 && px < w) {
        ctx.fillText(String(i), px - 4, this.offsetY + 12);
        ctx.beginPath();
        ctx.strokeStyle = '#B0BEC5';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.moveTo(px, this.offsetY - 3);
        ctx.lineTo(px, this.offsetY + 3);
        ctx.stroke();
      }
      if (py > 0 && py < h) {
        ctx.fillText(String(-i), this.offsetX + 4, py + 3);
        ctx.beginPath();
        ctx.moveTo(this.offsetX - 3, py);
        ctx.lineTo(this.offsetX + 3, py);
        ctx.stroke();
      }
    }
  }

  private drawMembers() {
    const ctx = this.ctx;
    const { nodes, members } = this.data;

    for (const member of members) {
      const startNode = nodes.find(n => n.id === member.startNodeId);
      const endNode = nodes.find(n => n.id === member.endNodeId);
      if (!startNode || !endNode) continue;

      const sp = this.worldToCanvas(startNode.worldX, startNode.worldY);
      const ep = this.worldToCanvas(endNode.worldX, endNode.worldY);

      const isSelected = this.options.selectedMemberId === member.id;

      ctx.save();
      ctx.strokeStyle = isSelected ? '#1565C0' : '#2563EB';
      ctx.lineWidth = isSelected ? 4 : 3;
      ctx.lineCap = 'round';
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(ep.x, ep.y);
      ctx.stroke();

      // Label giữa thanh
      const mx = (sp.x + ep.x) / 2;
      const my = (sp.y + ep.y) / 2;
      const angle = Math.atan2(ep.y - sp.y, ep.x - sp.x);

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(angle);
      ctx.fillStyle = '#1565C0';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(member.label || `L=${member.length.toFixed(1)}m`, 0, -8);
      ctx.restore();

      ctx.restore();
    }
  }

  private drawNodes() {
    const ctx = this.ctx;
    const { nodes } = this.data;

    for (const node of nodes) {
      const p = this.worldToCanvas(node.worldX, node.worldY);
      const isHovered = this.options.hoveredNodeId === node.id;
      const isSelected = this.options.selectedNodeId === node.id;

      // Draw support symbol first (below node circle)
      if (node.support) {
        this.drawSupport(ctx, p.x, p.y, node.support);
      }

      // Node circle
      ctx.save();
      ctx.beginPath();
      ctx.arc(p.x, p.y, NODE_RADIUS, 0, Math.PI * 2);

      if (isSelected) {
        ctx.fillStyle = '#F59E0B';
        ctx.strokeStyle = '#D97706';
      } else if (isHovered) {
        ctx.fillStyle = '#60A5FA';
        ctx.strokeStyle = '#2563EB';
      } else if (node.support) {
        ctx.fillStyle = '#DC2626';
        ctx.strokeStyle = '#991B1B';
      } else {
        ctx.fillStyle = '#FFFFFF';
        ctx.strokeStyle = '#2563EB';
      }

      ctx.lineWidth = 2;
      ctx.fill();
      ctx.stroke();

      // Node ID label
      ctx.fillStyle = '#1E293B';
      ctx.font = 'bold 10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(node.id, p.x, p.y);

      // Coordinate label
      ctx.fillStyle = '#475569';
      ctx.font = '9px Inter, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(
        `(${node.worldX.toFixed(1)}, ${node.worldY.toFixed(1)})`,
        p.x + NODE_RADIUS + 2,
        p.y - 6
      );

      ctx.restore();
    }
  }

  private drawSupport(ctx: CanvasRenderingContext2D, x: number, y: number, type: string) {
    ctx.save();
    const size = 16;

    switch (type) {
      case 'fixed': {
        // Ngàm: hình chữ nhật + gạch chéo
        ctx.fillStyle = '#94A3B8';
        ctx.strokeStyle = '#475569';
        ctx.lineWidth = 1.5;
        ctx.fillRect(x - size, y + NODE_RADIUS, size * 2, size);
        ctx.strokeRect(x - size, y + NODE_RADIUS, size * 2, size);
        // Gạch chéo
        for (let i = -size; i <= size; i += 6) {
          ctx.beginPath();
          ctx.moveTo(x + i, y + NODE_RADIUS + size);
          ctx.lineTo(x + i - 6, y + NODE_RADIUS + size + 6);
          ctx.stroke();
        }
        break;
      }
      case 'pin': {
        // Gối cố định: tam giác
        ctx.fillStyle = '#93C5FD';
        ctx.strokeStyle = '#2563EB';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y + NODE_RADIUS);
        ctx.lineTo(x - size, y + NODE_RADIUS + size);
        ctx.lineTo(x + size, y + NODE_RADIUS + size);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Ground line
        ctx.beginPath();
        ctx.moveTo(x - size - 4, y + NODE_RADIUS + size);
        ctx.lineTo(x + size + 4, y + NODE_RADIUS + size);
        ctx.stroke();
        // Gạch chéo nền
        ctx.strokeStyle = '#64748B';
        ctx.lineWidth = 1;
        for (let i = -size - 4; i <= size + 4; i += 6) {
          ctx.beginPath();
          ctx.moveTo(x + i, y + NODE_RADIUS + size);
          ctx.lineTo(x + i - 4, y + NODE_RADIUS + size + 5);
          ctx.stroke();
        }
        break;
      }
      case 'roller': {
        // Gối di động: tam giác + vòng tròn
        ctx.fillStyle = '#BBF7D0';
        ctx.strokeStyle = '#16A34A';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x, y + NODE_RADIUS);
        ctx.lineTo(x - size, y + NODE_RADIUS + size);
        ctx.lineTo(x + size, y + NODE_RADIUS + size);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        // Circle underneath
        ctx.beginPath();
        ctx.arc(x, y + NODE_RADIUS + size + 5, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        // Ground line
        ctx.beginPath();
        ctx.moveTo(x - size - 4, y + NODE_RADIUS + size + 9);
        ctx.lineTo(x + size + 4, y + NODE_RADIUS + size + 9);
        ctx.stroke();
        break;
      }
      case 'internal_hinge': {
        // Khớp nội: vòng tròn kép
        ctx.strokeStyle = '#7C3AED';
        ctx.fillStyle = '#EDE9FE';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, NODE_RADIUS + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        break;
      }
    }
    ctx.restore();
  }

  private drawLoads() {
    const ctx = this.ctx;
    const { nodes, members, loads } = this.data;

    for (const load of loads) {
      if (load.type === 'point_force') {
        let px = 0, py = 0;
        if (load.nodeId) {
          const node = nodes.find(n => n.id === load.nodeId);
          if (!node) continue;
          px = node.worldX; py = node.worldY;
        } else if (load.memberId) {
          const member = members.find(m => m.id === load.memberId);
          if (!member) continue;
          const sn = nodes.find(n => n.id === member.startNodeId)!;
          const en = nodes.find(n => n.id === member.endNodeId)!;
          px = sn.worldX + load.position * (en.worldX - sn.worldX);
          py = sn.worldY + load.position * (en.worldY - sn.worldY);
        }
        const p = this.worldToCanvas(px, py);
        this.drawForceArrow(ctx, p.x, p.y, load.angle, load.magnitude, '#DC2626', `P=${load.magnitude}kN`);

      } else if (load.type === 'distributed') {
        const member = members.find(m => m.id === load.memberId);
        if (!member) continue;
        const sn = nodes.find(n => n.id === member.startNodeId)!;
        const en = nodes.find(n => n.id === member.endNodeId)!;
        this.drawDistributedLoad(ctx, sn, en, load);

      } else if (load.type === 'moment') {
        let px = 0, py = 0;
        if (load.nodeId) {
          const node = nodes.find(n => n.id === load.nodeId);
          if (!node) continue;
          px = node.worldX; py = node.worldY;
        } else if (load.memberId) {
          const member = members.find(m => m.id === load.memberId);
          if (!member) continue;
          const sn = nodes.find(n => n.id === member.startNodeId)!;
          const en = nodes.find(n => n.id === member.endNodeId)!;
          px = sn.worldX + load.position * (en.worldX - sn.worldX);
          py = sn.worldY + load.position * (en.worldY - sn.worldY);
        }
        const p = this.worldToCanvas(px, py);
        this.drawMomentSymbol(ctx, p.x, p.y, load.magnitude);
      }
    }
  }

  drawForceArrow(
    ctx: CanvasRenderingContext2D,
    cx: number, cy: number,
    angleDeg: number, _magnitude: number,
    color: string, label: string
  ) {
    const LENGTH = 50;
    const angleRad = (angleDeg * Math.PI) / 180;

    // Direction of arrow (pointing toward the node)
    const dx = Math.cos(angleRad + Math.PI);
    const dy = -Math.sin(angleRad + Math.PI);

    const startX = cx + dx * LENGTH;
    const startY = cy + dy * LENGTH;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;

    // Arrow shaft
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(cx, cy);
    ctx.stroke();

    // Arrowhead
    const headLen = 12;
    const headAngle = 0.4;
    const ax = cx;
    const ay = cy;
    const arrAngle = Math.atan2(ay - startY, ax - startX);

    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(
      ax - headLen * Math.cos(arrAngle - headAngle),
      ay - headLen * Math.sin(arrAngle - headAngle)
    );
    ctx.lineTo(
      ax - headLen * Math.cos(arrAngle + headAngle),
      ay - headLen * Math.sin(arrAngle + headAngle)
    );
    ctx.closePath();
    ctx.fill();

    // Label
    ctx.fillStyle = color;
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, startX + dx * 10, startY + dy * 10 - 4);

    ctx.restore();
  }

  private drawDistributedLoad(
    ctx: CanvasRenderingContext2D,
    startNode: Node, endNode: Node, load: Load
  ) {
    const posStart = load.position ?? 0;
    const posEnd = load.positionEnd ?? 1;

    const x1w = startNode.worldX + posStart * (endNode.worldX - startNode.worldX);
    const y1w = startNode.worldY + posStart * (endNode.worldY - startNode.worldY);
    const x2w = startNode.worldX + posEnd * (endNode.worldX - startNode.worldX);
    const y2w = startNode.worldY + posEnd * (endNode.worldY - startNode.worldY);

    const p1 = this.worldToCanvas(x1w, y1w);
    const p2 = this.worldToCanvas(x2w, y2w);

    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return;

    const ARROW_HEIGHT = 30;
    const angleRad = (load.angle * Math.PI) / 180;
    const perpX = -Math.sin(angleRad);
    const perpY = Math.cos(angleRad);

    ctx.save();
    ctx.strokeStyle = '#7C3AED';
    ctx.fillStyle = 'rgba(124,58,237,0.12)';
    ctx.lineWidth = 1.5;

    const steps = Math.max(3, Math.floor(len / 20));
    const arrowTips: { x: number; y: number }[] = [];

    // Draw arrows
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ax = p1.x + t * dx;
      const ay = p1.y + t * dy;
      const bx = ax + perpX * ARROW_HEIGHT;
      const by = ay + perpY * ARROW_HEIGHT;

      arrowTips.push({ x: bx, y: by });

      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(ax, ay);
      ctx.stroke();

      // Small arrowhead
      const headLen = 6;
      const arrowAngle = Math.atan2(ay - by, ax - bx);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(
        ax - headLen * Math.cos(arrowAngle - 0.4),
        ay - headLen * Math.sin(arrowAngle - 0.4)
      );
      ctx.lineTo(
        ax - headLen * Math.cos(arrowAngle + 0.4),
        ay - headLen * Math.sin(arrowAngle + 0.4)
      );
      ctx.closePath();
      ctx.fillStyle = '#7C3AED';
      ctx.fill();
    }

    // Top connecting line
    ctx.beginPath();
    ctx.moveTo(arrowTips[0].x, arrowTips[0].y);
    for (const tip of arrowTips) {
      ctx.lineTo(tip.x, tip.y);
    }
    ctx.strokeStyle = '#7C3AED';
    ctx.stroke();

    // Label
    const mx = (p1.x + p2.x) / 2 + perpX * ARROW_HEIGHT;
    const my = (p1.y + p2.y) / 2 + perpY * ARROW_HEIGHT;
    ctx.fillStyle = '#7C3AED';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`q=${load.magnitude}kN/m`, mx, my - 6);

    ctx.restore();
  }

  drawMomentSymbol(ctx: CanvasRenderingContext2D, x: number, y: number, magnitude: number) {
    ctx.save();
    const r = 20;
    ctx.strokeStyle = '#EA580C';
    ctx.lineWidth = 2.5;

    // Arc
    ctx.beginPath();
    if (magnitude >= 0) {
      ctx.arc(x, y, r, 0.3, Math.PI * 1.8);
    } else {
      ctx.arc(x, y, r, Math.PI * 1.8, 0.3);
    }
    ctx.stroke();

    // Arrowhead at end of arc
    const endAngle = magnitude >= 0 ? Math.PI * 1.8 : 0.3;
    const ex = x + r * Math.cos(endAngle);
    const ey = y + r * Math.sin(endAngle);
    const perpAngle = endAngle + (magnitude >= 0 ? Math.PI / 2 : -Math.PI / 2);

    ctx.fillStyle = '#EA580C';
    ctx.beginPath();
    ctx.moveTo(ex, ey);
    ctx.lineTo(ex + 8 * Math.cos(perpAngle - 0.5), ey + 8 * Math.sin(perpAngle - 0.5));
    ctx.lineTo(ex + 8 * Math.cos(perpAngle + 0.5), ey + 8 * Math.sin(perpAngle + 0.5));
    ctx.closePath();
    ctx.fill();

    // Label
    ctx.fillStyle = '#EA580C';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`M=${magnitude}kN·m`, x, y - r - 6);

    ctx.restore();
  }

  private drawReactions(reactions: Reaction[]) {
    const { nodes } = this.data;
    const ctx = this.ctx;

    for (const reaction of reactions) {
      const node = nodes.find(n => n.id === reaction.nodeId);
      if (!node) continue;
      const p = this.worldToCanvas(node.worldX, node.worldY);

      if (reaction.Hx !== undefined && Math.abs(reaction.Hx) > 1e-6) {
        const angle = reaction.Hx > 0 ? 0 : 180;
        this.drawForceArrow(ctx, p.x, p.y, angle, Math.abs(reaction.Hx),
          '#059669', `H=${reaction.Hx.toFixed(2)}kN`);
      }
      if (reaction.Vy !== undefined && Math.abs(reaction.Vy) > 1e-6) {
        const angle = reaction.Vy > 0 ? 90 : 270;
        this.drawForceArrow(ctx, p.x, p.y, angle, Math.abs(reaction.Vy),
          '#059669', `V=${reaction.Vy.toFixed(2)}kN`);
      }
      if (reaction.M !== undefined && Math.abs(reaction.M) > 1e-6) {
        this.drawMomentSymbol(ctx, p.x - 40, p.y, reaction.M);
      }
    }
  }

  private drawTempLine(line: { x1: number; y1: number; x2: number; y2: number }) {
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
    ctx.restore();
  }

  private drawDimensions() {
    // Dimension lines for members
    const { nodes, members } = this.data;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = '#94A3B8';
    ctx.fillStyle = '#64748B';
    ctx.font = '10px Inter, sans-serif';
    ctx.lineWidth = 0.8;
    ctx.setLineDash([3, 3]);

    for (const member of members) {
      const sn = nodes.find(n => n.id === member.startNodeId);
      const en = nodes.find(n => n.id === member.endNodeId);
      if (!sn || !en) continue;

      const sp = this.worldToCanvas(sn.worldX, sn.worldY);
      const ep = this.worldToCanvas(en.worldX, en.worldY);
      const dx = ep.x - sp.x;
      const dy = ep.y - sp.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len < 2) continue;

      const nx = -dy / len;
      const ny = dx / len;
      const offset = 20;

      const x1 = sp.x + nx * offset;
      const y1 = sp.y + ny * offset;
      const x2 = ep.x + nx * offset;
      const y2 = ep.y + ny * offset;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Lấy snapshot của canvas dưới dạng base64 */
  toDataURL(type = 'image/png'): string {
    return this.canvas.toDataURL(type);
  }

  /** Snap một điểm canvas đến vị trí thế giới gần nhất (0.25m grid) */
  snapToGrid(cx: number, cy: number): { worldX: number; worldY: number } {
    const world = this.canvasToWorld(cx, cy);
    const snap = 0.5;
    return {
      worldX: Math.round(world.x / snap) * snap,
      worldY: Math.round(world.y / snap) * snap,
    };
  }

  /** Tìm node gần điểm click nhất */
  findNearestNode(cx: number, cy: number, threshold = 20): Node | null {
    let minDist = threshold;
    let nearest: Node | null = null;

    for (const node of this.data.nodes) {
      const p = this.worldToCanvas(node.worldX, node.worldY);
      const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
      if (dist < minDist) {
        minDist = dist;
        nearest = node;
      }
    }
    return nearest;
  }

  /** Tìm member gần điểm click nhất */
  findNearestMember(cx: number, cy: number, threshold = 12): Member | null {
    let minDist = threshold;
    let nearest: Member | null = null;

    for (const member of this.data.members) {
      const sn = this.data.nodes.find(n => n.id === member.startNodeId);
      const en = this.data.nodes.find(n => n.id === member.endNodeId);
      if (!sn || !en) continue;

      const sp = this.worldToCanvas(sn.worldX, sn.worldY);
      const ep = this.worldToCanvas(en.worldX, en.worldY);

      const dist = pointToSegmentDistance(cx, cy, sp.x, sp.y, ep.x, ep.y);
      if (dist < minDist) {
        minDist = dist;
        nearest = member;
      }
    }
    return nearest;
  }
}

function pointToSegmentDistance(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - ax) ** 2 + (py - ay) ** 2);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.sqrt((px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2);
}
