/**
 * solver.ts – Client-side Static Mechanics Solver
 * Giải bài toán tĩnh định: tính phản lực liên kết từ dữ liệu cấu hình
 * Sử dụng phương pháp phương trình cân bằng tĩnh học
 */

import type { StructureData, SolverResult, Reaction, Node } from '../types/mechanics';

// Tính cos và sin theo độ
const cosDeg = (d: number) => Math.cos((d * Math.PI) / 180);
const sinDeg = (d: number) => Math.sin((d * Math.PI) / 180);

/**
 * Tính số bậc siêu tĩnh
 * n = r - 3 (với cấu trúc phẳng một thanh/khung đơn giản)
 */
function countReactionComponents(nodes: Node[]): number {
  let r = 0;
  for (const n of nodes) {
    if (n.support === 'fixed') r += 3;
    else if (n.support === 'pin') r += 2;
    else if (n.support === 'roller') r += 1;
  }
  return r;
}

/**
 * Tính tổng hợp lực và momen từ tải trọng ngoại
 */
function computeExternalLoads(data: StructureData) {
  const { nodes, members, loads } = data;

  let sumFx = 0; // tổng lực theo x
  let sumFy = 0; // tổng lực theo y
  let sumMoments: { value: number; desc: string }[] = [];

  // Điểm tính momen: lấy node đầu tiên có liên kết
  // (hoặc origin nếu không có)
  const momentOrigin = { x: 0, y: 0 };
  const pivotNode = nodes.find(n => n.support);
  if (pivotNode) {
    momentOrigin.x = pivotNode.worldX;
    momentOrigin.y = pivotNode.worldY;
  }

  for (const load of loads) {
    if (load.type === 'point_force') {
      const fx = load.magnitude * cosDeg(load.angle);
      const fy = load.magnitude * sinDeg(load.angle);

      let px = momentOrigin.x;
      let py = momentOrigin.y;

      if (load.nodeId) {
        const node = nodes.find(n => n.id === load.nodeId);
        if (node) { px = node.worldX; py = node.worldY; }
      } else if (load.memberId) {
        const member = members.find(m => m.id === load.memberId);
        if (member) {
          const startNode = nodes.find(n => n.id === member.startNodeId)!;
          const endNode = nodes.find(n => n.id === member.endNodeId)!;
          px = startNode.worldX + load.position * (endNode.worldX - startNode.worldX);
          py = startNode.worldY + load.position * (endNode.worldY - startNode.worldY);
        }
      }

      sumFx += fx;
      sumFy += fy;

      // Momen = r × F (moment arm từ pivot)
      const rx = px - momentOrigin.x;
      const ry = py - momentOrigin.y;
      const moment = rx * fy - ry * fx; // dương = ngược chiều kim đồng hồ

      sumMoments.push({
        value: moment,
        desc: `Lực tập trung P=${load.magnitude}kN ở (${px.toFixed(2)}, ${py.toFixed(2)})`
      });

    } else if (load.type === 'distributed') {
      const member = members.find(m => m.id === load.memberId);
      if (!member) continue;

      const startNode = nodes.find(n => n.id === member.startNodeId)!;
      const endNode = nodes.find(n => n.id === member.endNodeId)!;

      const posStart = load.position ?? 0;
      const posEnd = load.positionEnd ?? 1;

      const x1 = startNode.worldX + posStart * (endNode.worldX - startNode.worldX);
      const y1 = startNode.worldY + posStart * (endNode.worldY - startNode.worldY);
      const x2 = startNode.worldX + posEnd * (endNode.worldX - startNode.worldX);
      const y2 = startNode.worldY + posEnd * (endNode.worldY - startNode.worldY);

      const segLength = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      const totalForce = load.magnitude * segLength;

      const fx = totalForce * cosDeg(load.angle);
      const fy = totalForce * sinDeg(load.angle);

      // Điểm đặt của hợp lực tại trọng tâm đoạn
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;

      sumFx += fx;
      sumFy += fy;

      const rx = cx - momentOrigin.x;
      const ry = cy - momentOrigin.y;
      const moment = rx * fy - ry * fx;

      sumMoments.push({
        value: moment,
        desc: `Tải phân bố q=${load.magnitude}kN/m trên L=${segLength.toFixed(2)}m, hợp lực=${totalForce.toFixed(2)}kN tại (${cx.toFixed(2)}, ${cy.toFixed(2)})`
      });

    } else if (load.type === 'moment') {
      // Momen tập trung: không tạo lực nhưng cộng vào tổng momen
      sumMoments.push({
        value: load.magnitude,
        desc: `Momen tập trung M=${load.magnitude}kN·m`
      });
    }
  }

  const totalMoment = sumMoments.reduce((s, m) => s + m.value, 0);

  return { sumFx, sumFy, totalMoment, momentDetails: sumMoments, momentOrigin };
}

/**
 * Hàm giải chính
 */
export function solve(data: StructureData): SolverResult {
  const { nodes } = data;
  const steps: string[] = [];
  const equations: string[] = [];
  const freeBodyDescription: string[] = [];

  // 1. Kiểm tra cấu hình
  const r = countReactionComponents(nodes);
  const doi = r - 3; // Degree of Indeterminacy

  steps.push(`## 📐 Phân Tích Cấu Trúc`);
  steps.push(`- **Số ẩn phản lực:** r = ${r}`);
  steps.push(`- **Số phương trình cân bằng:** 3 (ΣFx=0, ΣFy=0, ΣM=0)`);
  steps.push(`- **Bậc siêu tĩnh:** n = r - 3 = ${doi}`);

  if (r === 0) {
    steps.push(`⚠️ **Chưa có liên kết nào!** Hãy thêm gối tựa/ngàm vào mô hình.`);
    return {
      reactions: [],
      steps,
      equations,
      freeBodyDescription,
      isStaticallyDeterminate: false,
      degreeOfIndeterminacy: doi,
      sumFx: 0, sumFy: 0, sumM: 0
    };
  }

  if (doi !== 0) {
    if (doi < 0) {
      steps.push(`⚠️ **Cơ cấu** (r < 3): Hệ không đủ liên kết, không thể đứng vững.`);
    } else {
      steps.push(`ℹ️ **Hệ siêu tĩnh bậc ${doi}**: Không thể giải bằng 3 phương trình cân bằng thuần túy. Cần phương pháp biến dạng.`);
    }
    return {
      reactions: [],
      steps,
      equations,
      freeBodyDescription,
      isStaticallyDeterminate: false,
      degreeOfIndeterminacy: doi,
      sumFx: 0, sumFy: 0, sumM: 0
    };
  }

  steps.push(`✅ **Hệ tĩnh định** (r = 3): Có thể giải bằng phương trình cân bằng.`);
  steps.push(`---`);

  // 2. Tính tải trọng ngoại
  const { sumFx: totalFx, sumFy: totalFy, totalMoment, momentDetails, momentOrigin } =
    computeExternalLoads(data);

  steps.push(`## 🔍 Xác Định Ngoại Lực`);
  steps.push(`**Điểm tính momen:** O(${momentOrigin.x.toFixed(2)}, ${momentOrigin.y.toFixed(2)}) m`);
  steps.push(`\n**Danh sách tải trọng:**`);
  for (const det of momentDetails) {
    steps.push(`- ${det.desc}: momen = ${det.value.toFixed(4)} kN·m`);
  }
  steps.push(`\n**Tổng ngoại lực tác dụng:**`);
  steps.push(`- ΣFx (ngoại) = ${totalFx.toFixed(4)} kN`);
  steps.push(`- ΣFy (ngoại) = ${totalFy.toFixed(4)} kN`);
  steps.push(`- ΣM (ngoại, quanh O) = ${totalMoment.toFixed(4)} kN·m`);
  steps.push(`---`);

  // 3. Xác định ẩn số phản lực
  steps.push(`## ⚙️ Xác Định Phản Lực`);
  freeBodyDescription.push(`Sơ đồ vật thể tự do (FBD):`);

  const supportNodes = nodes.filter(n => n.support);
  let unknowns: { nodeId: string; type: 'Hx' | 'Vy' | 'M'; label: string }[] = [];

  for (const node of supportNodes) {
    if (node.support === 'fixed') {
      unknowns.push({ nodeId: node.id, type: 'Hx', label: `H_{${node.id}}` });
      unknowns.push({ nodeId: node.id, type: 'Vy', label: `V_{${node.id}}` });
      unknowns.push({ nodeId: node.id, type: 'M', label: `M_{${node.id}}` });
      freeBodyDescription.push(`- Ngàm cố định tại Node ${node.id}: phản lực H, V, M`);
    } else if (node.support === 'pin') {
      unknowns.push({ nodeId: node.id, type: 'Hx', label: `H_{${node.id}}` });
      unknowns.push({ nodeId: node.id, type: 'Vy', label: `V_{${node.id}}` });
      freeBodyDescription.push(`- Gối cố định (khớp) tại Node ${node.id}: phản lực H, V`);
    } else if (node.support === 'roller') {
      unknowns.push({ nodeId: node.id, type: 'Vy', label: `V_{${node.id}}` });
      freeBodyDescription.push(`- Gối di động tại Node ${node.id}: phản lực V`);
    }
  }

  steps.push(`**Các ẩn số:** ${unknowns.map(u => u.label).join(', ')}`);

  // 4. Thiết lập và giải hệ phương trình
  // Phương trình: [A]{x} = {b}
  // 3 phương trình: ΣFx=0, ΣFy=0, ΣM_O=0
  // Với 3 ẩn: tuỳ theo loại liên kết

  // Tìm pivot node (node đầu tiên có liên kết)
  const pivotSupportNode = supportNodes[0];
  const pivotCoords = { x: pivotSupportNode.worldX, y: pivotSupportNode.worldY };

  // Ma trận A (3x3) và vector b (3x1)
  const A: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const b: number[] = [-totalFx, -totalFy, -totalMoment];

  for (let i = 0; i < unknowns.length; i++) {
    const u = unknowns[i];
    const node = nodes.find(n => n.id === u.nodeId)!;
    const rx = node.worldX - pivotCoords.x;
    const ry = node.worldY - pivotCoords.y;

    if (u.type === 'Hx') {
      A[0][i] = 1;   // ΣFx
      A[1][i] = 0;   // ΣFy
      A[2][i] = -ry; // ΣM (Hx tạo momen = Hx * (-ry))
    } else if (u.type === 'Vy') {
      A[0][i] = 0;   // ΣFx
      A[1][i] = 1;   // ΣFy
      A[2][i] = rx;  // ΣM (Vy tạo momen = Vy * rx)
    } else if (u.type === 'M') {
      A[0][i] = 0;
      A[1][i] = 0;
      A[2][i] = 1;   // ΣM (momen phản lực cộng trực tiếp)
    }
  }

  // Giải hệ phương trình Ax = b bằng phương pháp Gauss-Jordan
  const solution = gaussJordan(A, b);

  if (!solution) {
    steps.push(`⚠️ Không thể giải hệ phương trình (ma trận kỳ dị). Kiểm tra lại cấu hình liên kết.`);
    return {
      reactions: [],
      steps,
      equations,
      freeBodyDescription,
      isStaticallyDeterminate: false,
      degreeOfIndeterminacy: 0,
      sumFx: 0, sumFy: 0, sumM: 0
    };
  }

  // 5. Xuất phương trình LaTeX
  steps.push(`\n## 📝 Hệ Phương Trình Cân Bằng`);

  // Tạo chuỗi phương trình
  const eqFx = buildEquationFx(unknowns, solution, totalFx);
  const eqFy = buildEquationFy(unknowns, solution, totalFy);
  const eqM = buildEquationM(unknowns, solution, totalMoment, nodes, pivotCoords);

  equations.push(eqFx);
  equations.push(eqFy);
  equations.push(eqM);

  steps.push(`**Phương trình ΣFx = 0:**`);
  steps.push(eqFx);
  steps.push(`**Phương trình ΣFy = 0:**`);
  steps.push(eqFy);
  steps.push(`**Phương trình ΣM_O = 0:**`);
  steps.push(eqM);

  steps.push(`\n---`);
  steps.push(`## ✅ Kết Quả Phản Lực`);

  // 6. Tổng hợp kết quả
  const reactions: Reaction[] = [];
  const reactionMap: Record<string, Reaction> = {};

  for (let i = 0; i < unknowns.length; i++) {
    const u = unknowns[i];
    if (!reactionMap[u.nodeId]) {
      reactionMap[u.nodeId] = { nodeId: u.nodeId };
      reactions.push(reactionMap[u.nodeId]);
    }
    const val = solution[i];
    if (u.type === 'Hx') reactionMap[u.nodeId].Hx = val;
    else if (u.type === 'Vy') reactionMap[u.nodeId].Vy = val;
    else if (u.type === 'M') reactionMap[u.nodeId].M = val;

    const label = u.type === 'Hx' ? 'H' : u.type === 'Vy' ? 'V' : 'M';
    steps.push(`- **${label}_{Node ${u.nodeId}}** = ${val.toFixed(4)} kN${u.type === 'M' ? '·m' : ''}`);
  }

  // 7. Kiểm tra
  steps.push(`\n---`);
  steps.push(`## 🔎 Kiểm Tra Lại (Verification)`);

  let checkFx = totalFx;
  let checkFy = totalFy;
  let checkM = totalMoment;

  for (let i = 0; i < unknowns.length; i++) {
    const u = unknowns[i];
    const val = solution[i];
    if (u.type === 'Hx') { checkFx += val; }
    else if (u.type === 'Vy') { checkFy += val; }
    else if (u.type === 'M') { checkM += val; }
  }
  void checkM;

  // Kiểm tra momen tại pivot
  let checkMPivot = totalMoment;
  for (let i = 0; i < unknowns.length; i++) {
    const u = unknowns[i];
    const node = nodes.find(n => n.id === u.nodeId)!;
    const val = solution[i];
    const rx = node.worldX - pivotCoords.x;
    const ry = node.worldY - pivotCoords.y;

    if (u.type === 'Hx') checkMPivot += val * (-ry);
    else if (u.type === 'Vy') checkMPivot += val * rx;
    else if (u.type === 'M') checkMPivot += val;
  }

  const eps = 1e-6;
  steps.push(`- ΣFx = ${checkFx.toFixed(6)} kN ${Math.abs(checkFx) < eps ? '✅' : '❌'}`);
  steps.push(`- ΣFy = ${checkFy.toFixed(6)} kN ${Math.abs(checkFy) < eps ? '✅' : '❌'}`);
  steps.push(`- ΣM_O = ${checkMPivot.toFixed(6)} kN·m ${Math.abs(checkMPivot) < eps ? '✅' : '❌'}`);

  if (Math.abs(checkFx) < eps && Math.abs(checkFy) < eps && Math.abs(checkMPivot) < eps) {
    steps.push(`\n✅ **Lời giải chính xác!** Tất cả phương trình cân bằng được thỏa mãn.`);
  } else {
    steps.push(`\n⚠️ **Cần kiểm tra lại:** Sai số vượt ngưỡng cho phép.`);
  }

  return {
    reactions,
    steps,
    equations,
    freeBodyDescription,
    isStaticallyDeterminate: true,
    degreeOfIndeterminacy: 0,
    sumFx: checkFx,
    sumFy: checkFy,
    sumM: checkMPivot
  };
}

/**
 * Gauss-Jordan elimination để giải hệ Ax = b
 */
function gaussJordan(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  // Tạo ma trận tăng cường [A|b]
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Tìm pivot
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-12) return null; // Kỳ dị

    // Chuẩn hóa hàng pivot
    const pivot = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] /= pivot;

    // Khử các hàng khác
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  return M.map(row => row[n]);
}

function buildEquationFx(unknowns: any[], _solution: number[], totalFx: number): string {
  let parts: string[] = [];
  for (let i = 0; i < unknowns.length; i++) {
    if (unknowns[i].type === 'Hx') {
      parts.push(`H_{${unknowns[i].nodeId}}`);
    }
  }
  if (Math.abs(totalFx) > 1e-9) {
    parts.push(`(${totalFx.toFixed(2)})`);
  }
  return `\\sum F_x = 0: \\quad ${parts.join(' + ')} = 0`;
}

function buildEquationFy(unknowns: any[], _solution: number[], totalFy: number): string {
  let parts: string[] = [];
  for (let i = 0; i < unknowns.length; i++) {
    if (unknowns[i].type === 'Vy') {
      parts.push(`V_{${unknowns[i].nodeId}}`);
    }
  }
  if (Math.abs(totalFy) > 1e-9) {
    parts.push(`(${(-totalFy).toFixed(2)})`);
  }
  return `\\sum F_y = 0: \\quad ${parts.join(' + ')} = 0`;
}

function buildEquationM(unknowns: any[], _solution: number[], totalMoment: number, nodes: Node[], pivot: { x: number, y: number }): string {
  let parts: string[] = [];
  for (let i = 0; i < unknowns.length; i++) {
    const u = unknowns[i];
    const node = nodes.find(n => n.id === u.nodeId)!;
    const rx = node.worldX - pivot.x;
    const ry = node.worldY - pivot.y;

    if (u.type === 'Hx' && Math.abs(ry) > 1e-9) {
      parts.push(`${(-ry).toFixed(2)} \\cdot H_{${u.nodeId}}`);
    } else if (u.type === 'Vy' && Math.abs(rx) > 1e-9) {
      parts.push(`${rx.toFixed(2)} \\cdot V_{${u.nodeId}}`);
    } else if (u.type === 'M') {
      parts.push(`M_{${u.nodeId}}`);
    }
  }

  if (Math.abs(totalMoment) > 1e-9) {
    parts.push(`(${(-totalMoment).toFixed(2)})`);
  }

  return `\\sum M_O = 0: \\quad ${parts.join(' + ')} = 0`;
}
