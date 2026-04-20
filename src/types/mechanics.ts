export type SupportType = 'fixed' | 'pin' | 'roller' | 'free' | 'internal_hinge';

export type LoadType = 'point_force' | 'distributed' | 'moment';

export interface Point {
  x: number;
  y: number;
}

export interface Node {
  id: string;
  x: number;       // canvas x
  y: number;       // canvas y
  worldX: number;  // world coordinate (m)
  worldY: number;
  support?: SupportType;
}

export interface Member {
  id: string;
  startNodeId: string;
  endNodeId: string;
  length: number;   // m
  angle: number;    // degrees from horizontal
  label?: string;
}

export interface Load {
  id: string;
  type: LoadType;
  memberId?: string;
  nodeId?: string;
  magnitude: number;   // kN or kN/m
  angle: number;       // degrees (0 = right, 90 = up, 270 = down)
  position: number;    // ratio 0..1 along member, or 0 for node loads
  positionEnd?: number; // for distributed loads, end ratio
}

export interface Reaction {
  nodeId: string;
  Hx?: number;  // kN
  Vy?: number;  // kN
  M?: number;   // kN·m
}

export interface SolverResult {
  reactions: Reaction[];
  steps: string[];
  equations: string[];
  freeBodyDescription: string[];
  isStaticallyDeterminate: boolean;
  degreeOfIndeterminacy: number;
  sumFx: number;
  sumFy: number;
  sumM: number;
}

export interface StructureData {
  nodes: Node[];
  members: Member[];
  loads: Load[];
}

export type ToolMode =
  | 'select'
  | 'add_node'
  | 'add_member'
  | 'add_support'
  | 'add_load'
  | 'add_distributed'
  | 'add_moment';

export type SupportMode =
  | 'fixed'
  | 'pin'
  | 'roller'
  | 'internal_hinge';
