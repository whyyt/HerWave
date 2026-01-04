'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { ethers } from 'ethers';

// 扩展 Window 接口以支持 ethereum
declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: any[] }) => Promise<any>;
      send: (method: string, params?: any[]) => Promise<any>;
      isMetaMask?: boolean;
    };
  }
}

// 智能合约 ABI（简化版，实际使用时需要完整 ABI）
const CONTRACT_ABI = [
  "function registerUser(string memory _name, string memory _location) public",
  "function createRequest(string memory _title, string memory _description, string memory _location, uint256 _helpType) public",
  "function acceptRequest(uint256 _requestId) public",
  "function completeRequest(uint256 _requestId) public",
  "function submitReview(uint256 _requestId, address _reviewed, uint256 _rating, string memory _comment) public",
  "function getUser(address _user) public view returns (tuple(string name, string location, uint256 trustScore, uint256 totalHelps, uint256 totalReceived, uint256 wave, bool exists))",
  "function getUserWave(address _user) public view returns (uint256)",
  "function getWaveCost(uint256 _helpType) public view returns (uint256)",
  "function waveCosts(uint256) public view returns (uint256)",
  "function WAVE_REWARD() public view returns (uint256)",
  "function getRequest(uint256 _requestId) public view returns (tuple(uint256 id, address requester, string title, string description, string location, uint256 timestamp, uint8 status, address helper, uint256 helpType))",
  "function requestCount() public view returns (uint256)",
  "function getOpenRequests() public view returns (tuple(uint256 id, address requester, string title, string description, string location, uint256 timestamp, uint8 status, address helper, uint256 helpType)[])",
  "function getUserRequests(address _user) public view returns (tuple(uint256 id, address requester, string title, string description, string location, uint256 timestamp, uint8 status, address helper, uint256 helpType)[])",
  "event RequestCreated(uint256 indexed requestId, address indexed requester, string title)",
  "event RequestMatched(uint256 indexed requestId, address indexed helper)",
  "event RequestCompleted(uint256 indexed requestId)",
  "event UserRegistered(address indexed user, string name)"
];

// 合约地址（每次重新部署后需要更新）
const CONTRACT_ADDRESS = "0xDfb4Dd5551902ed8EDdb84CFa7bD9822799290a2"; // Sepolia 测试网

// Sepolia 测试网配置
const SEPOLIA_CHAIN_CONFIG = {
  chainId: '0xAA36A7', // 11155111 的十六进制
  chainName: 'Sepolia',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['https://sepolia.infura.io/v3/YOUR_INFURA_KEY'], // 请替换为你的 Infura 或 Alchemy RPC URL
  blockExplorerUrls: ['https://sepolia.etherscan.io'],
};

// 本地链配置（用于开发）
const LOCAL_CHAIN_CONFIG = {
  chainId: '0x7A69', // 31337 的十六进制
  chainName: 'Hardhat Local',
  nativeCurrency: {
    name: 'Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: ['http://127.0.0.1:8545'],
  blockExplorerUrls: [],
};

type View = 'home' | 'requests' | 'create' | 'profile' | 'dashboard';

interface User {
  name: string;
  location: string;
  trustScore: number;
  totalHelps: number;
  totalReceived: number;
  wave: number;
  exists: boolean;
}

// 扩展的请求状态类型
type RequestStatus = 'OPEN' | 'IN_PROGRESS' | 'COMPLETED';

interface Request {
  id: number;
  requester: string; // requesterAddress
  title: string;
  description: string;
  location: string;
  timestamp: number;
  status: number; // 0: Open, 1: Matched, 2: Completed, 3: Cancelled (保留兼容)
  helper: string; // helperAddress
  helpType: number;
  // 新增字段
  statusNew?: RequestStatus; // 新的状态字段
  nftMinted?: boolean;
  waveRewarded?: boolean;
  createdAt?: number; // 创建时间戳
}

// 用户资料接口（扩展）
interface UserProfile {
  address: string;
  wave: number;
}

interface Thread {
  id: number;
  from: { x: number; y: number };
  to: { x: number; y: number };
  delay: number;
  duration: number;
}

// SVG 网络节点类型
interface NetworkNode {
  id: string;
  country: string;
  city: string;
  x: number; // 0-100 百分比坐标
  y: number; // 0-100 百分比坐标
  memberCount: number; // 人数
}

interface NetworkEdge {
  from: string; // node id
  to: string; // node id
}

// 城市坐标映射（百分比位置）
const cityPositions: Record<string, { x: number; y: number }> = {
  // 亚洲
  "首尔": { x: 78, y: 36 },
  "北京": { x: 75, y: 32 },
  "上海": { x: 77, y: 40 },
  "香港": { x: 74, y: 48 },
  "台北": { x: 77, y: 46 },
  "俄罗斯": { x: 68, y: 52 },
  "新加坡": { x: 68, y: 62 },
  "吉隆坡": { x: 67, y: 60 },
  "河内": { x: 70, y: 48 },
  "马尼拉": { x: 77, y: 54 },
  "雅加达": { x: 70, y: 68 },
  "大阪": { x: 80, y: 40 },
  "京都": { x: 79, y: 40 },
  // 欧洲
  "埃及": { x: 48, y: 30 },
  "伦敦": { x: 46, y: 26 },
  "冰岛": { x: 52, y: 28 },
  "柏林": { x: 52, y: 36 },
  "马德里": { x: 44, y: 36 },
  "阿姆斯特丹": { x: 49, y: 26 },
  "维也纳": { x: 54, y: 30 },
  "布拉格": { x: 53, y: 28 },
  "巴塞罗那": { x: 47, y: 36 },
  // 北美
  "纽约": { x: 24, y: 34 },
  "洛杉矶": { x: 14, y: 40 },
  "旧金山": { x: 12, y: 38 },
  "西雅图": { x: 13, y: 30 },
  "芝加哥": { x: 20, y: 34 },
  "加拿大": { x: 22, y: 32 },
  "温哥华": { x: 12, y: 28 },
  // 大洋洲
  "悉尼": { x: 86, y: 76 },
  "墨尔本": { x: 84, y: 78 },
  "奥克兰": { x: 92, y: 78 },
  // 南美
  "圣保罗": { x: 30, y: 72 },
  "布宜诺斯艾利斯": { x: 28, y: 78 },
  "里约热内卢": { x: 32, y: 70 },
  // 非洲
  "开普敦": { x: 52, y: 80 },
  "开罗": { x: 56, y: 42 },
  // 中东
  "迪拜": { x: 62, y: 48 },
  "伊斯坦布尔": { x: 56, y: 36 },
};

// 默认热点城市位置
const defaultHotspots = [
  { x: 68, y: 52, label: "曼谷" },
  { x: 86, y: 36, label: "首尔" },
  { x: 77, y: 46, label: "台北" },
  { x: 38, y: 34, label: "纽约" },
  { x: 92, y: 76, label: "悉尼" },
];

// ============================================
// 修复：确定性随机数生成器（Seeded Random）
// ============================================
// 问题：之前使用 Math.random() 在模块顶层生成随机数，导致 SSR 和客户端 hydration 时结果不一致
// 解决：使用 seeded random，seed 基于 chainId + contractAddress，确保同一环境生成相同结果
class SeededRandom {
  private seed: number;

  constructor(seed: string | number) {
    // 将字符串 seed 转换为数字
    if (typeof seed === 'string') {
      let hash = 0;
      for (let i = 0; i < seed.length; i++) {
        const char = seed.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      this.seed = Math.abs(hash);
    } else {
      this.seed = Math.abs(seed);
    }
  }

  // 生成 0-1 之间的随机数
  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  // 生成 min-max 之间的随机整数
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
}

// SVG 网络节点基础数据（固定坐标，不包含随机 memberCount）
const NETWORK_NODES_BASE: Omit<NetworkNode, 'memberCount'>[] = [
  { id: 'cn', country: '中国', city: '北京', x: 75, y: 32 },
  { id: 'jp', country: '日本', city: '东京', x: 82, y: 38 },
  { id: 'kr', country: '韩国', city: '首尔', x: 78, y: 36 },
  { id: 'tw', country: '台湾', city: '台北', x: 77, y: 46 },
  { id: 'th', country: '泰国', city: '曼谷', x: 68, y: 52 },
  { id: 'sg', country: '新加坡', city: '新加坡', x: 68, y: 62 },
  { id: 'us', country: '美国', city: '纽约', x: 24, y: 34 },
  { id: 'us2', country: '美国', city: '洛杉矶', x: 14, y: 40 },
  { id: 'uk', country: '英国', city: '伦敦', x: 46, y: 26 },
  { id: 'fr', country: '法国', city: '巴黎', x: 48, y: 30 },
  { id: 'de', country: '德国', city: '柏林', x: 52, y: 28 },
  { id: 'it', country: '意大利', city: '罗马', x: 52, y: 36 },
  { id: 'au', country: '澳大利亚', city: '悉尼', x: 92, y: 76 },
  { id: 'ae', country: '阿联酋', city: '迪拜', x: 62, y: 48 },
  { id: 'ca', country: '加拿大', city: '多伦多', x: 22, y: 32 },
];

// 生成网络连接线（确定性算法，基于节点坐标）
function generateEdges(nodes: NetworkNode[]): NetworkEdge[] {
  const edges: NetworkEdge[] = [];
  const maxConnections = 3;
  
  for (let i = 0; i < nodes.length; i++) {
    const distances: Array<{ index: number; distance: number }> = [];
    for (let j = 0; j < nodes.length; j++) {
      if (i !== j) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        distances.push({ index: j, distance });
      }
    }
    // 按距离排序，选择最近的几个（确定性排序）
    distances.sort((a, b) => {
      if (a.distance !== b.distance) {
        return a.distance - b.distance;
      }
      // 如果距离相同，按索引排序确保确定性
      return a.index - b.index;
    });
    const connections = distances.slice(0, maxConnections);
    connections.forEach(conn => {
      // 避免重复边
      const edgeExists = edges.some(e => 
        (e.from === nodes[i].id && e.to === nodes[conn.index].id) ||
        (e.from === nodes[conn.index].id && e.to === nodes[i].id)
      );
      if (!edgeExists) {
        edges.push({ from: nodes[i].id, to: nodes[conn.index].id });
      }
    });
  }
  
  return edges;
}

// 网络层视觉控制
const LINE_OPACITY = 0.65;               // 连接线默认透明度（0-1）
const LINE_OPACITY_SELECTED = 0.85;       // 选中时连接线透明度（0-1）
const NODE_GLOW_INTENSITY = 0.4;         // 节点发光强度（0-1）
const NODE_GLOW_SELECTED = 0.8;          // 选中节点发光强度（0-1）

// ============================================
// 状态管理：帮助流程数据（localStorage 持久化）
// ============================================
interface UserProfile {
  address: string;
  wave: number;
}

interface HelpRequestState {
  requests: Request[];
  profiles: Record<string, UserProfile>;
}

const STORAGE_KEY = 'herweave_help_requests';

const loadHelpState = (): HelpRequestState => {
  if (typeof window === 'undefined') {
    return { requests: [], profiles: {} };
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn('Failed to load help state:', error);
  }
  return { requests: [], profiles: {} };
};

const saveHelpState = (state: HelpRequestState) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Failed to save help state:', error);
  }
};

export default function Home() {
  const [account, setAccount] = useState<string | null>(null);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [contract, setContract] = useState<ethers.Contract | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [requests, setRequests] = useState<Request[]>([]);
  const [currentView, setCurrentView] = useState<View>('home');
  const [loading, setLoading] = useState(false);
  const [contractDeployed, setContractDeployed] = useState<boolean | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [hoveredCity, setHoveredCity] = useState<string | null>(null);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const disconnectTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // 帮助流程状态管理
  const [helpState, setHelpState] = useState<HelpRequestState>(() => loadHelpState());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  
  // SVG 网络图状态
  const [selectedNode, setSelectedNode] = useState<NetworkNode | null>(null);
  const [cardPosition, setCardPosition] = useState<{ x: number; y: number } | null>(null);
  const networkContainerRef = useRef<HTMLDivElement>(null);
  const [mapImageLoaded, setMapImageLoaded] = useState(false);
  
  // 节点拖拽状态（互助广场）
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  
  // 主页节点拖拽状态
  const [draggingHomeNode, setDraggingHomeNode] = useState<string | null>(null);
  const [homeDragStart, setHomeDragStart] = useState<{ x: number; y: number } | null>(null);
  const [homeDragOffset, setHomeDragOffset] = useState<{ x: number; y: number } | null>(null);
  
  // 加载主页节点位置
  const loadHomeHotspots = () => {
    if (typeof window === 'undefined') return defaultHotspots;
    try {
      const saved = localStorage.getItem('herweave_home_hotspots');
      if (saved) {
        const savedPositions: Record<string, { x: number; y: number }> = JSON.parse(saved);
        // 检查是否有"悉尼"节点需要移动到"接送一程"上方
        const updatedHotspots = defaultHotspots.map(hotspot => {
          const savedPos = savedPositions[hotspot.label];
          if (savedPos) {
            // 如果是"悉尼"节点，且位置不在"接送一程"上方，则移动到上方
            if (hotspot.label === "悉尼" && savedPos.y > 30) {
              return { ...hotspot, x: 85, y: 25 };
            }
            return { ...hotspot, x: savedPos.x, y: savedPos.y };
          }
          // 如果是"悉尼"节点，默认移动到"接送一程"上方
          if (hotspot.label === "悉尼") {
            return { ...hotspot, x: 85, y: 25 };
          }
          return hotspot;
        });
        return updatedHotspots;
      }
    } catch (error) {
      console.warn('Failed to load saved home hotspots:', error);
    }
    // 默认位置：将"悉尼"节点移动到"接送一程"上方
    return defaultHotspots.map(hotspot => {
      if (hotspot.label === "悉尼") {
        return { ...hotspot, x: 85, y: 25 };
      }
      return hotspot;
    });
  };
  
  const [homeHotspots, setHomeHotspots] = useState(() => loadHomeHotspots());
  
  // 保存主页节点位置
  const saveHomeHotspots = (hotspots: typeof defaultHotspots) => {
    if (typeof window === 'undefined') return;
    try {
      const positions: Record<string, { x: number; y: number }> = {};
      hotspots.forEach(hotspot => {
        positions[hotspot.label] = { x: hotspot.x, y: hotspot.y };
      });
      localStorage.setItem('herweave_home_hotspots', JSON.stringify(positions));
    } catch (error) {
      console.warn('Failed to save home hotspots:', error);
    }
  };
  
  // 主页节点拖拽处理函数
  const handleHomeNodeMouseDown = (e: React.MouseEvent<SVGCircleElement>, hotspot: typeof defaultHotspots[0]) => {
    e.stopPropagation();
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    
    const svgRect = svg.getBoundingClientRect();
    const containerRect = svg.parentElement?.getBoundingClientRect();
    if (!containerRect) return;
    
    // 获取鼠标在容器中的位置（百分比）
    const mouseX = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    const mouseY = ((e.clientY - containerRect.top) / containerRect.height) * 100;
    
    // 计算偏移量
    const offsetX = mouseX - hotspot.x;
    const offsetY = mouseY - hotspot.y;
    
    setDraggingHomeNode(hotspot.label);
    setHomeDragStart({ x: mouseX, y: mouseY });
    setHomeDragOffset({ x: offsetX, y: offsetY });
  };

  const handleHomeNodeMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingHomeNode || !homeDragStart) return;
    
    const svg = e.currentTarget;
    const containerRect = svg.parentElement?.getBoundingClientRect();
    if (!containerRect) return;
    
    // 获取鼠标在容器中的位置（百分比）
    const mouseX = ((e.clientX - containerRect.left) / containerRect.width) * 100;
    const mouseY = ((e.clientY - containerRect.top) / containerRect.height) * 100;
    
    // 计算鼠标移动的距离
    const deltaX = mouseX - homeDragStart.x;
    const deltaY = mouseY - homeDragStart.y;
    
    setHomeDragOffset({ x: deltaX, y: deltaY });
  };

  const handleHomeNodeMouseUp = () => {
    if (!draggingHomeNode || !homeDragOffset) {
      setDraggingHomeNode(null);
      setHomeDragStart(null);
      setHomeDragOffset(null);
      return;
    }
    
    const hotspot = homeHotspots.find(h => h.label === draggingHomeNode);
    if (!hotspot) {
      setDraggingHomeNode(null);
      setHomeDragStart(null);
      setHomeDragOffset(null);
      return;
    }
    
    // 计算新位置（百分比坐标）
    const newX = hotspot.x + homeDragOffset.x;
    const newY = hotspot.y + homeDragOffset.y;
    
    // 限制在 viewBox 范围内 (0-100)
    const clampedX = Math.max(0, Math.min(100, newX));
    const clampedY = Math.max(0, Math.min(100, newY));
    
    // 更新节点位置
    const updatedHotspots = homeHotspots.map(h => 
      h.label === draggingHomeNode 
        ? { ...h, x: clampedX, y: clampedY }
        : h
    );
    
    setHomeHotspots(updatedHotspots);
    saveHomeHotspots(updatedHotspots);
    
    // 重置拖拽状态
    setDraggingHomeNode(null);
    setHomeDragStart(null);
    setHomeDragOffset(null);
  };
  
  // ============================================
  // 修复：使用 useMemo 生成确定性节点和连线
  // ============================================
  // 问题：之前在模块顶层使用 Math.random() 生成节点，导致 SSR 和客户端不一致
  // 解决：在组件内使用 useMemo，seed 基于 chainId + contractAddress，确保可复现
  const [chainId, setChainId] = useState<number | null>(null);
  
  // 获取当前链 ID（用于生成 seed）
  useEffect(() => {
    if (provider) {
      provider.getNetwork()
        .then(network => {
          setChainId(Number(network.chainId));
        })
        .catch((error: any) => {
          // 处理网络切换错误
          if (error.code === 'NETWORK_ERROR' || error.message?.includes('network changed')) {
            console.log('🔄 检测到网络切换，等待后重试获取链 ID...');
            setTimeout(() => {
              provider.getNetwork()
                .then(network => {
                  setChainId(Number(network.chainId));
                })
                .catch(() => {
                  setChainId(null);
                });
            }, 1000);
          } else {
            setChainId(null);
          }
        });
    } else {
      setChainId(null);
    }
  }, [provider]);
  
  // 生成确定性节点（基于 seed）
  const networkNodes = useMemo(() => {
    // 只在客户端执行
    if (typeof window === 'undefined') {
      return NETWORK_NODES_BASE.map(node => ({ ...node, memberCount: 300 }));
    }
    
    // 生成 seed：chainId + contractAddress（如果都没有，使用固定值）
    const seedString = chainId !== null 
      ? `${chainId}_${CONTRACT_ADDRESS}` 
      : `herweave_${CONTRACT_ADDRESS}`;
    const rng = new SeededRandom(seedString);
    
    // 为每个节点生成确定性的 memberCount
    return NETWORK_NODES_BASE.map((node, index) => {
      // 使用节点索引作为额外 seed，确保每个节点都有不同的随机数序列
      const nodeRng = new SeededRandom(`${seedString}_${node.id}_${index}`);
      return {
        ...node,
        memberCount: nodeRng.nextInt(100, 500) // 100-500 之间的确定性随机数
      };
    });
  }, [chainId]); // 依赖 chainId，当链切换时重新生成
  
  // 生成确定性连线（基于节点）
  const networkEdges = useMemo(() => {
    return generateEdges(networkNodes);
  }, [networkNodes]);
  
  // 从 localStorage 加载保存的节点位置
  const loadSavedNodePositions = (): NetworkNode[] => {
    if (typeof window === 'undefined') return networkNodes;
    
    try {
      const saved = localStorage.getItem('herweave_node_positions');
      if (saved) {
        const savedPositions: Record<string, { x: number; y: number }> = JSON.parse(saved);
        return networkNodes.map(node => {
          const savedPos = savedPositions[node.id];
          if (savedPos) {
            return { ...node, x: savedPos.x, y: savedPos.y };
          }
          return node;
        });
      }
    } catch (error) {
      console.warn('Failed to load saved node positions:', error);
    }
    return networkNodes;
  };

  // 初始化节点：先使用基础数据，等 networkNodes 生成后再更新
  const [nodes, setNodes] = useState<NetworkNode[]>(() => {
    // SSR 时返回基础数据
    if (typeof window === 'undefined') {
      return NETWORK_NODES_BASE.map(node => ({ ...node, memberCount: 300 }));
    }
    // 客户端初始化时，先返回基础数据（不包含随机 memberCount）
    // 真正的 networkNodes 会在 useMemo 中生成，然后通过 useEffect 更新
    return NETWORK_NODES_BASE.map(node => ({ ...node, memberCount: 300 }));
  });
  
  // 当 networkNodes 变化时，更新 nodes（但保留 localStorage 中的位置）
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('herweave_node_positions');
      if (saved) {
        try {
          const savedPositions: Record<string, { x: number; y: number }> = JSON.parse(saved);
          setNodes(networkNodes.map(node => {
            const savedPos = savedPositions[node.id];
            if (savedPos) {
              return { ...node, x: savedPos.x, y: savedPos.y };
            }
            return node;
          }));
        } catch (error) {
          setNodes(networkNodes);
        }
      } else {
        setNodes(networkNodes);
      }
    }
  }, [networkNodes]);

  // 预加载 map.png 图片
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const img = new Image();
    img.onload = () => {
      setMapImageLoaded(true);
    };
    img.onerror = () => {
      // 即使加载失败，也设置为true，避免一直等待
      console.warn('map.png 加载失败');
      setMapImageLoaded(true);
    };
    img.src = '/map.png';
  }, []);
  
  // 保存节点位置到 localStorage
  const saveNodePositions = (updatedNodes: NetworkNode[]) => {
    if (typeof window === 'undefined') return;
    
    try {
      const positions: Record<string, { x: number; y: number }> = {};
      updatedNodes.forEach(node => {
        positions[node.id] = { x: node.x, y: node.y };
      });
      localStorage.setItem('herweave_node_positions', JSON.stringify(positions));
    } catch (error) {
      console.warn('Failed to save node positions:', error);
    }
  };

  // 拖拽处理函数
  const handleNodeMouseDown = (e: React.MouseEvent<SVGCircleElement>, node: NetworkNode) => {
    e.stopPropagation();
    const container = networkContainerRef.current;
    if (!container) return;
    
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return;
    
    const containerRect = container.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    
    // 获取鼠标在容器中的位置
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;
    
    // 将容器坐标转换为 SVG viewBox 坐标 (0-1000, 0-500)
    const scaleX = 1000 / containerRect.width;
    const scaleY = 500 / containerRect.height;
    const svgX = mouseX * scaleX;
    const svgY = mouseY * scaleY;
    
    // 获取节点当前在 viewBox 中的位置
    const nodeX = (node.x / 100) * 1000;
    const nodeY = (node.y / 100) * 500;
    
    // 计算偏移量
    const offsetX = svgX - nodeX;
    const offsetY = svgY - nodeY;
    
    setDraggingNode(node.id);
    setDragStart({ x: mouseX, y: mouseY });
    setDragOffset({ x: offsetX, y: offsetY });
  };

  const handleNodeMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!draggingNode || !dragStart || !networkContainerRef.current) return;
    
    const container = networkContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    // 获取鼠标在容器中的位置
    const mouseX = e.clientX - containerRect.left;
    const mouseY = e.clientY - containerRect.top;
    
    // 计算鼠标移动的距离
    const deltaX = mouseX - dragStart.x;
    const deltaY = mouseY - dragStart.y;
    
    // 将容器坐标转换为 SVG viewBox 坐标的偏移量
    const scaleX = 1000 / containerRect.width;
    const scaleY = 500 / containerRect.height;
    const offsetX = deltaX * scaleX;
    const offsetY = deltaY * scaleY;
    
    setDragOffset({ x: offsetX, y: offsetY });
  };

  const handleNodeMouseUp = () => {
    if (!draggingNode || !dragOffset) return;
    
    const node = nodes.find(n => n.id === draggingNode);
    if (!node || !networkContainerRef.current) {
      setDraggingNode(null);
      setDragStart(null);
      setDragOffset(null);
      return;
    }
    
    const container = networkContainerRef.current;
    const containerRect = container.getBoundingClientRect();
    
    // 获取节点原始位置（百分比坐标转换为 viewBox 坐标）
    const originalX = (node.x / 100) * 1000;
    const originalY = (node.y / 100) * 500;
    
    // 计算新位置（viewBox 坐标）
    const newX = originalX + dragOffset.x;
    const newY = originalY + dragOffset.y;
    
    // 限制在 viewBox 范围内 (0-1000, 0-500)
    const clampedX = Math.max(0, Math.min(1000, newX));
    const clampedY = Math.max(0, Math.min(500, newY));
    
    // 转换回百分比坐标 (0-100)
    const newPercentX = (clampedX / 1000) * 100;
    const newPercentY = (clampedY / 500) * 100;
    
    // 更新节点位置
    const updatedNodes = nodes.map(n => 
      n.id === draggingNode 
        ? { ...n, x: newPercentX, y: newPercentY }
        : n
    );
    
    setNodes(updatedNodes);
    saveNodePositions(updatedNodes);
    
    // 重置拖拽状态
    setDraggingNode(null);
    setDragStart(null);
    setDragOffset(null);
  };
  
  // 音乐播放状态
  const [isPlaying, setIsPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false); // 用户是否手动暂停
  const audioRef = useRef<HTMLAudioElement>(null);

  // 页面加载时，如果已连接钱包，检查合约状态
  useEffect(() => {
    if (account && provider) {
      // 延迟检查，确保网络切换完成
      const timer = setTimeout(() => {
        checkContractDeployed(provider);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [account, provider]);

  // 自动恢复钱包地址显示（1秒后）
  useEffect(() => {
    if (showDisconnect) {
      // 清除之前的定时器
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
      }
      // 设置1秒后自动恢复
      disconnectTimerRef.current = setTimeout(() => {
        setShowDisconnect(false);
        disconnectTimerRef.current = null;
      }, 1000);
    }
    // 清理函数
    return () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
    };
  }, [showDisconnect]);

  // 生成编织线程动画（修复：使用确定性随机数）
  useEffect(() => {
    const points = homeHotspots.map(h => ({ x: h.x, y: h.y }));
    if (points.length < 2) return;

    // 使用固定 seed 生成确定性动画参数
    const threadSeed = `threads_${CONTRACT_ADDRESS}`;
    const rng = new SeededRandom(threadSeed);

    const newThreads: Thread[] = [];
    let threadId = 0;

    // 创建编织效果的连接线
    for (let i = 0; i < points.length; i++) {
      // 每个点连接到2-3个其他点
      const connections = Math.min(3, points.length - 1);
      for (let j = 0; j < connections; j++) {
        const targetIndex = (i + j + 1) % points.length;
        if (targetIndex !== i) {
          newThreads.push({
            id: threadId++,
            from: points[i],
            to: points[targetIndex],
            delay: rng.next() * 3, // 确定性延迟
            duration: 2 + rng.next() * 2 // 确定性持续时间
          });
        }
      }
    }

    setThreads(newThreads);
  }, []); // 只在组件挂载时执行一次

  // 处理 ESC 键关闭卡片
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedNode) {
        setSelectedNode(null);
        setCardPosition(null);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [selectedNode]);

  // 连接钱包后自动播放音乐（仅在用户未手动暂停时）
  useEffect(() => {
    if (account && audioRef.current && !userPaused) {
      // 检查当前播放状态，避免重复播放
      if (audioRef.current.paused) {
        audioRef.current.play().then(() => {
          setIsPlaying(true);
        }).catch((error) => {
          console.warn('音乐播放失败（可能需要用户交互）:', error);
        });
      }
    } else if (!account && audioRef.current) {
      // 断开连接时停止音乐
      audioRef.current.pause();
      setIsPlaying(false);
      setUserPaused(false); // 重置用户暂停状态
    }
  }, [account, userPaused]);

  // 切换播放/暂停
  const toggleMusic = () => {
    if (!audioRef.current) return;
    
    if (isPlaying) {
      // 用户手动暂停
      audioRef.current.pause();
      setIsPlaying(false);
      setUserPaused(true); // 标记为用户手动暂停
    } else {
      // 用户手动播放
      audioRef.current.play().then(() => {
        setIsPlaying(true);
        setUserPaused(false); // 清除用户暂停标记
      }).catch((error) => {
        console.warn('音乐播放失败:', error);
      });
    }
  };

  // 监听音频播放状态（但不影响用户手动控制）
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handlePlay = () => {
      // 只有在不是用户手动暂停的情况下才更新状态
      if (!userPaused) {
        setIsPlaying(true);
      }
    };
    const handlePause = () => {
      // 如果是因为断开连接导致的暂停，不更新 userPaused
      if (!account) {
        setIsPlaying(false);
        setUserPaused(false);
      } else {
        setIsPlaying(false);
      }
    };
    const handleEnded = () => setIsPlaying(false);

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [account, userPaused]);
  
  // 创建请求表单
  const [reqTitle, setReqTitle] = useState('');
  const [reqDescription, setReqDescription] = useState('');
  const [reqLocation, setReqLocation] = useState('');
  const [reqHelpType, setReqHelpType] = useState(0);

  // 检查合约是否已部署
  const checkContractDeployed = async (provider: ethers.BrowserProvider) => {
    try {
      console.log('🔍 开始检查合约部署状态...');
      console.log('📍 合约地址:', CONTRACT_ADDRESS);
      
      // 检查网络
      const SEPOLIA_CHAIN_ID = 11155111;
      const LOCAL_CHAIN_IDS = [31337, 1337];
      
      let network;
      let chainId;
      try {
        network = await provider.getNetwork();
        chainId = Number(network.chainId);
        
        const isCorrectNetwork = chainId === SEPOLIA_CHAIN_ID || LOCAL_CHAIN_IDS.includes(chainId);
        
        console.log('🌐 当前网络:', {
          chainId: chainId,
          name: network.name,
          expectedChainId: [SEPOLIA_CHAIN_ID, ...LOCAL_CHAIN_IDS],
          isCorrectNetwork: isCorrectNetwork
        });
      } catch (networkError: any) {
        // 处理网络切换错误（ethers.js v6 在网络切换时会抛出 NETWORK_ERROR）
        if (networkError.code === 'NETWORK_ERROR' || networkError.message?.includes('network changed')) {
          console.log('🔄 检测到网络切换，等待网络稳定后重试...');
          // 等待网络稳定
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            network = await provider.getNetwork();
            chainId = Number(network.chainId);
            console.log('✅ 网络切换完成，当前链 ID:', chainId);
          } catch (retryError: any) {
            console.warn('⚠️ 重试获取网络信息失败:', retryError);
            setContractDeployed(false);
            return false;
          }
        } else {
          console.error('❌ 获取网络信息失败:', networkError);
          setContractDeployed(false);
          return false;
        }
      }
      
      // 验证网络是否正确（支持 Sepolia 和本地链）
      const isCorrectNetwork = chainId === SEPOLIA_CHAIN_ID || LOCAL_CHAIN_IDS.includes(chainId);
      
      if (!isCorrectNetwork) {
        console.warn('⚠️ 网络不匹配！当前链 ID:', chainId, '期望:', [SEPOLIA_CHAIN_ID, ...LOCAL_CHAIN_IDS]);
        console.warn('💡 提示：请确保 MetaMask 已切换到 Sepolia 测试网或本地链');
        setContractDeployed(false);
        return false;
      }
      
      // 检查合约代码
      let code;
      try {
        code = await provider.getCode(CONTRACT_ADDRESS);
      } catch (codeError: any) {
        // 处理网络切换错误
        if (codeError.code === 'NETWORK_ERROR' || codeError.message?.includes('network changed')) {
          console.log('🔄 检测到网络切换，等待网络稳定后重试...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            code = await provider.getCode(CONTRACT_ADDRESS);
            console.log('✅ 重试获取合约代码成功');
          } catch (retryError: any) {
            console.warn('⚠️ 重试获取合约代码失败:', retryError);
            setContractDeployed(false);
            return false;
          }
        } else {
          console.error('❌ 获取合约代码失败:', codeError);
          setContractDeployed(false);
          return false;
        }
      }
      
      const codeLength = code?.length || 0;
      const isEmpty = !code || code === '0x' || code.length <= 2;
      
      console.log('📄 合约代码检查:', {
        codeLength: codeLength,
        codePreview: code?.substring(0, 30) + '...',
        isEmpty: isEmpty,
        hasCode: codeLength > 2
      });
      
      const deployed = !isEmpty && codeLength > 2;
      
      if (deployed) {
        console.log('✅ 合约已部署！');
        console.log('📋 合约信息:', {
          address: CONTRACT_ADDRESS,
          codeLength: codeLength,
          network: network.name,
          chainId: chainId
        });
        setContractDeployed(true);
      } else {
        console.log('❌ 合约未部署或地址不正确');
        console.log('🔍 检查详情:', {
          address: CONTRACT_ADDRESS,
          codeLength: codeLength,
          isEmpty: isEmpty,
          network: network.name,
          chainId: chainId,
          expectedChainId: [31337, 1337]
        });
        console.warn('💡 请运行: npx hardhat run scripts/deploy.js --network sepolia');
        setContractDeployed(false);
      }
      
      return deployed;
    } catch (error: any) {
      console.error('❌ 检查合约部署状态失败:', error);
      console.error('错误详情:', {
        message: error.message,
        code: error.code,
        data: error.data,
        stack: error.stack
      });
      setContractDeployed(false);
      return false;
    }
  };

  // 切换到 Sepolia 测试网
  const switchToSepolia = async () => {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('MetaMask 未安装');
    }

    try {
      // 先检查当前网络
      const currentChainId = await window.ethereum.request({
        method: 'eth_chainId',
      });
      
      const SEPOLIA_CHAIN_ID = '0xAA36A7'; // 11155111
      
      console.log('🔍 当前链 ID:', currentChainId);
      
      // 如果已经是 Sepolia，直接返回
      if (currentChainId === SEPOLIA_CHAIN_ID) {
        console.log('✅ 已在 Sepolia 测试网');
        return;
      }

      // 尝试切换到 Sepolia
      try {
        await window.ethereum.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: SEPOLIA_CHAIN_ID }],
        });
        console.log('✅ 已切换到 Sepolia 测试网');
      } catch (switchError: any) {
        // 如果链不存在，则添加它
        if (switchError.code === 4902 || switchError.code === -32603) {
          console.log('📝 Sepolia 测试网不存在，正在添加...');
          try {
            await window.ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [SEPOLIA_CHAIN_CONFIG],
            });
            console.log('✅ 已添加并切换到 Sepolia 测试网');
          } catch (addError: any) {
            console.error('❌ 添加 Sepolia 测试网失败:', addError);
            throw new Error('无法添加 Sepolia 测试网，请手动在 MetaMask 中添加：\n网络名称: Sepolia\nRPC URL: https://sepolia.infura.io/v3/YOUR_INFURA_KEY\n链 ID: 11155111\n区块浏览器: https://sepolia.etherscan.io');
          }
        } else if (switchError.code === 4001) {
          // 用户拒绝了请求
          console.warn('⚠️ 用户拒绝了网络切换');
          throw new Error('用户拒绝了网络切换请求');
        } else {
          console.error('❌ 切换链失败:', switchError);
          throw switchError;
        }
      }
    } catch (error: any) {
      console.error('❌ 网络切换过程出错:', error);
      throw error;
    }
  };

  // 连接钱包
  const connectWallet = async () => {
    // 检查 MetaMask 是否已安装
    if (typeof window.ethereum === 'undefined') {
      alert('请先安装 MetaMask 浏览器扩展\n\n访问 https://metamask.io 下载安装');
      return;
    }

    // 检查是否是 MetaMask
    if (!window.ethereum.isMetaMask) {
      alert('请使用 MetaMask 钱包连接');
      return;
    }

    setLoading(true);
    
    try {
      console.log('🔗 开始连接 MetaMask 钱包...');
      console.log('📱 正在请求 MetaMask 账户连接（将弹出连接窗口）...');
      
      // 重要：先检查是否已有账户连接
      // 如果没有连接，eth_requestAccounts 会弹出 MetaMask 连接窗口
      // 如果已连接，MetaMask 可能不会弹出，但会返回已连接的账户
      let accounts: string[];
      
      try {
        // 使用 eth_requestAccounts 触发 MetaMask 连接弹窗
        // 这是标准的 MetaMask 连接方法，会弹出连接确认窗口
        accounts = await window.ethereum.request({
          method: 'eth_requestAccounts'
        }) as string[];
        
        console.log('📱 MetaMask 连接请求已发送，等待用户确认...');
      } catch (requestError: any) {
        // 如果用户拒绝了连接请求
        if (requestError.code === 4001 || requestError.message?.includes('user rejected') || requestError.message?.includes('User rejected')) {
          console.log('❌ 用户取消了连接请求');
          setLoading(false);
          return; // 用户取消，直接返回，不执行后续操作
        }
        throw requestError; // 其他错误继续抛出
      }
      
      // 检查是否获取到账户
      if (!accounts || accounts.length === 0) {
        throw new Error('未获取到账户，请重试');
      }
      
      console.log('✅ MetaMask 账户已连接:', accounts[0]);
      
      // 创建 provider 和合约实例
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);
      
      setProvider(provider);
      setContract(contract);
      setAccount(accounts[0]);
      
      // 尝试切换到 Sepolia 测试网（如果失败也不影响连接）
      console.log('🔄 尝试切换到 Sepolia 测试网...');
      try {
        await switchToSepolia();
        // 等待网络切换完成
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (switchError: any) {
        console.warn('⚠️ 网络切换失败，继续使用当前网络...', switchError);
        // 网络切换失败不影响连接，用户可以手动切换
      }
      
      // 钱包签名认证
      try {
        const message = `连接 Her Weave 钱包\n\n账户地址: ${accounts[0]}\n\n请签名确认连接此钱包到 Her Weave 平台。`;
        
        setToastMessage('请在弹出的 MetaMask 窗口中签名确认...');
        try {
          const signature = await signer.signMessage(message);
          console.log('✅ 签名成功:', signature);
          setToastMessage('✅ 钱包连接成功');
          setTimeout(() => setToastMessage(null), 3000);
        } catch (signError: any) {
          // 如果用户拒绝了签名请求
          if (signError.code === 4001 || signError.message?.includes('user rejected') || signError.message?.includes('User rejected')) {
            setToastMessage('签名已取消，钱包连接已断开');
            setTimeout(() => setToastMessage(null), 3000);
            // 断开连接
            setAccount(null);
            setProvider(null);
            setContract(null);
            setLoading(false);
            return;
          }
          throw signError;
        }
      } catch (signError: any) {
        console.error('签名失败:', signError);
        setToastMessage('签名失败: ' + (signError.message || '未知错误'));
        setTimeout(() => setToastMessage(null), 3000);
        // 断开连接
        setAccount(null);
        setProvider(null);
        setContract(null);
        setLoading(false);
        return;
      }
      
      // 连接成功后立即跳转到仪表板页面
      setCurrentView('dashboard');
      
      // 检查合约是否已部署
      const deployed = await checkContractDeployed(provider);
      
      // 无论合约是否部署，都尝试加载数据
      console.log('📥 开始加载数据...');
      
      // 每次连接钱包时，确保该地址默认有10个wave
      setHelpState(prevState => {
        const updatedProfiles = { ...prevState.profiles };
        const address = accounts[0].toLowerCase();
        const currentProfile = updatedProfiles[address];
        const currentWave = currentProfile?.wave || 0;
        
        // 如果该地址没有记录，或者wave小于10，则设置为10
        if (!currentProfile || currentWave < 10) {
          updatedProfiles[address] = {
            address: accounts[0],
            wave: 10
          };
        }
        
        const newState = {
          ...prevState,
          profiles: updatedProfiles
        };
        // 保存到 localStorage
        saveHelpState(newState);
        return newState;
      });
      
      // 加载用户信息
      if (deployed) {
        try {
          await loadUser(accounts[0], contract);
          console.log('✅ 用户信息加载完成');
        } catch (error) {
          console.warn('⚠️ 加载用户信息失败:', error);
        }
      } else {
        // 如果合约未部署，也设置默认wave
        setUser({
          name: '',
          location: '',
          trustScore: 50,
          totalHelps: 0,
          totalReceived: 0,
          wave: 10,
          exists: false
        });
      }
      
      // 加载请求列表（无论合约是否部署都尝试）
      try {
        console.log('📥 开始加载请求列表...');
        await loadRequests(contract);
        console.log('✅ 请求列表加载完成');
      } catch (error) {
        console.warn('⚠️ 加载请求列表失败:', error);
        // 即使失败也设置空数组，避免显示错误状态
        setRequests([]);
      }
      
      if (!deployed) {
        console.warn('⚠️ 合约未部署，请确保：');
        console.warn('1. Hardhat 节点正在运行 (npx hardhat node)');
        console.warn('2. 合约已部署 (npx hardhat run scripts/deploy.js --network localhost)');
      }
    } catch (error: any) {
      console.error('❌ 连接钱包失败:', error);
      
      // 更友好的错误提示
      let errorMessage = '连接钱包失败';
      
      if (error.code === 4001) {
        errorMessage = '您取消了连接请求';
      } else if (error.code === -32002) {
        errorMessage = '连接请求已在进行中，请检查 MetaMask 弹窗';
      } else if (error.message?.includes('user rejected') || error.message?.includes('User rejected')) {
        errorMessage = '您取消了连接请求';
      } else if (error.message?.includes('无法添加本地链')) {
        errorMessage = '无法自动添加本地链，请手动在 MetaMask 中添加：\n网络名称: Hardhat Local\nRPC URL: http://127.0.0.1:8545\n链 ID: 31337';
      } else {
        errorMessage = error.message || '连接失败，请确保 MetaMask 已安装并解锁';
      }
      
      alert(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // 加载用户信息
  const loadUser = async (address: string, contractInstance: ethers.Contract) => {
    try {
      // 先检查合约是否已部署
      if (!contractInstance.runner || !provider) {
        console.warn('合约实例或 provider 无效');
        return;
      }

      // 再次确认合约已部署
      let code;
      try {
        code = await provider.getCode(CONTRACT_ADDRESS);
      } catch (codeError: any) {
        // 处理网络切换错误
        if (codeError.code === 'NETWORK_ERROR' || codeError.message?.includes('network changed')) {
          console.log('🔄 检测到网络切换，等待网络稳定后重试...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            code = await provider.getCode(CONTRACT_ADDRESS);
          } catch (retryError: any) {
            console.warn('⚠️ 重试获取合约代码失败，跳过加载用户信息:', retryError);
            return;
          }
        } else {
          console.warn('⚠️ 获取合约代码失败，跳过加载用户信息:', codeError);
          return;
        }
      }
      
      if (!code || code === '0x') {
        console.warn('合约未部署，跳过加载用户信息');
        setContractDeployed(false);
        return;
      }

        try {
          let userData;
          try {
            userData = await contractInstance.getUser(address);
          } catch (callError: any) {
            // 处理网络切换错误
            if (callError.code === 'NETWORK_ERROR' || callError.message?.includes('network changed')) {
              console.log('🔄 检测到网络切换，等待网络稳定后重试...');
              await new Promise(resolve => setTimeout(resolve, 1000));
              userData = await contractInstance.getUser(address);
            } else {
              throw callError;
            }
          }
          
          // 检查返回的数据是否有效
          if (userData && userData.exists) {
            // 处理wave字段（可能是BigNumber）
            // 如果链上wave为0或不存在，使用本地状态，否则使用链上的值
            const chainWave = userData.wave ? Number(userData.wave) : 0;
            const localProfile = helpState.profiles[address.toLowerCase()];
            const localWave = localProfile?.wave || 0;
            // 如果链上wave为0且本地也没有，则默认10
            const wave = chainWave > 0 ? chainWave : (localWave > 0 ? localWave : 10);
            
            // 保留当前用户状态中可能已经更新的统计数字（如果存在）
            // 这样可以避免在 confirmHelpCompleted 后重新加载时覆盖更新
            // 只有当加载的是当前用户的信息时，才需要合并更新
            const isCurrentUser = address.toLowerCase() === account?.toLowerCase();
            const currentTotalHelps = (isCurrentUser && user) ? (user.totalHelps ?? 0) : 0;
            const currentTotalReceived = (isCurrentUser && user) ? (user.totalReceived ?? 0) : 0;
            
            // 如果加载的是当前用户的信息，使用 Math.max 合并更新
            // 如果加载的是其他用户的信息，直接使用链上的值
            const finalTotalHelps = isCurrentUser 
              ? Math.max(Number(userData.totalHelps) || 0, currentTotalHelps)
              : (Number(userData.totalHelps) || 0);
            const finalTotalReceived = isCurrentUser
              ? Math.max(Number(userData.totalReceived) || 0, currentTotalReceived)
              : (Number(userData.totalReceived) || 0);
            
            // 只有当加载的是当前用户的信息时，才更新 user 状态
            if (isCurrentUser) {
              setUser({
                name: userData.name || '',
                location: userData.location || '',
                trustScore: Number(userData.trustScore) || 50,
                totalHelps: finalTotalHelps,
                totalReceived: finalTotalReceived,
                // wave 使用计算后的值
                wave: wave,
                exists: true
              });
            }
            
            // 确保本地状态中也有10个wave（如果链上为0且本地也没有）
            if (chainWave === 0 && (!localProfile || localProfile.wave === 0 || localProfile.wave === undefined)) {
              setHelpState(prevState => {
                const updatedProfiles = { ...prevState.profiles };
                updatedProfiles[address.toLowerCase()] = {
                  address: address,
                  wave: 10
                };
                return {
                  ...prevState,
                  profiles: updatedProfiles
                };
              });
            }
          } else {
            // 用户未注册，这是正常情况，设置默认值
            console.log('用户未注册，使用默认值');
            setUser({
              name: '',
              location: '',
              trustScore: 50,
              totalHelps: 0,
              totalReceived: 0,
              wave: 10,
              exists: false
            });
          }
      } catch (callError: any) {
        // 处理合约调用错误
        if (callError.code === 'BAD_DATA' || callError.message?.includes('could not decode')) {
          console.warn('合约调用失败，可能是合约未部署或 ABI 不匹配');
          setContractDeployed(false);
        } else {
          console.error('调用 getUser 失败:', callError);
          setUser(null);
        }
      }
    } catch (error: any) {
      console.error('加载用户信息失败:', error);
      setUser(null);
    }
  };

  // 加载请求列表
  const loadRequests = async (contractInstance: ethers.Contract) => {
    try {
      console.log('🔍 loadRequests 开始执行...');
      console.log('📋 合约实例:', contractInstance);
      console.log('📋 Provider:', provider);
      
      // 先检查合约实例和 provider
      if (!contractInstance || !contractInstance.runner || !provider) {
        console.warn('⚠️ 合约实例或 provider 无效');
        setRequests([]);
        return;
      }

      // 检查合约是否已部署
      let code;
      try {
        code = await provider.getCode(CONTRACT_ADDRESS);
        console.log('📄 合约代码检查:', code ? `有代码 (${code.length} 字符)` : '无代码');
      } catch (codeError: any) {
        // 处理网络切换错误
        if (codeError.code === 'NETWORK_ERROR' || codeError.message?.includes('network changed')) {
          console.log('🔄 检测到网络切换，等待网络稳定后重试...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          try {
            code = await provider.getCode(CONTRACT_ADDRESS);
            console.log('✅ 重试获取合约代码成功');
          } catch (retryError: any) {
            console.warn('⚠️ 重试获取合约代码失败:', retryError);
            setContractDeployed(false);
            setRequests([]);
            return;
          }
        } else {
          console.warn('⚠️ 获取合约代码失败:', codeError);
          setContractDeployed(false);
          setRequests([]);
          return;
        }
      }
      
      if (!code || code === '0x') {
        console.warn('⚠️ 合约未部署，跳过加载请求');
        setContractDeployed(false);
        setRequests([]);
        return;
      }

      console.log('✅ 合约已部署，开始获取请求...');
      setContractDeployed(true);

      try {
        // 先检查请求总数
        console.log('📊 正在获取请求总数...');
        let totalCount;
        try {
          totalCount = await contractInstance.requestCount();
        } catch (callError: any) {
          // 处理网络切换错误
          if (callError.code === 'NETWORK_ERROR' || callError.message?.includes('network changed')) {
            console.log('🔄 检测到网络切换，等待网络稳定后重试...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            totalCount = await contractInstance.requestCount();
          } else {
            throw callError;
          }
        }
        const count = Number(totalCount);
        console.log('📊 当前请求总数:', count);
        
        if (count === 0) {
          console.log('ℹ️ 当前没有请求');
          setRequests([]);
          return;
        }

        // 获取所有开放的请求
        console.log('📥 正在调用 getOpenRequests()...');
        let openRequests;
        try {
          openRequests = await contractInstance.getOpenRequests();
        } catch (callError: any) {
          // 处理网络切换错误
          if (callError.code === 'NETWORK_ERROR' || callError.message?.includes('network changed')) {
            console.log('🔄 检测到网络切换，等待网络稳定后重试...');
            await new Promise(resolve => setTimeout(resolve, 1000));
            openRequests = await contractInstance.getOpenRequests();
          } else {
            throw callError;
          }
        }
        console.log('📥 getOpenRequests() 返回:', openRequests);
        console.log('📥 数据类型:', typeof openRequests, '是否为数组:', Array.isArray(openRequests));
        console.log('📥 数组长度:', Array.isArray(openRequests) ? openRequests.length : 'N/A');
        
        // 处理空数组或无效数据
        if (!openRequests || !Array.isArray(openRequests) || openRequests.length === 0) {
          console.log('ℹ️ 当前没有开放的请求');
          setRequests([]);
          return;
        }

        // 转换并过滤请求（只显示状态为 Open 的请求）
        console.log('🔄 开始处理请求数据...');
        const validRequests = openRequests
          .map((r: any, index: number) => {
            const request = {
              id: Number(r.id),
              requester: r.requester,
              title: r.title,
              description: r.description,
              location: r.location,
              timestamp: Number(r.timestamp),
              status: Number(r.status),
              helper: r.helper,
              helpType: Number(r.helpType)
            };
            console.log(`📋 请求 ${index + 1}:`, request);
            return request;
          })
          .filter((r: Request) => {
            const isOpen = r.status === 0; // 0 = Open
            if (!isOpen) {
              console.log(`⏭️ 跳过请求 ${r.id}，状态: ${r.status} (非开放)`);
            }
            return isOpen;
          });

        console.log('✅ 成功加载请求:', validRequests.length, '个开放请求');
        console.log('📋 最终请求列表:', validRequests);
        setRequests(validRequests);
      } catch (callError: any) {
        // 处理合约调用错误
        console.error('❌ 调用合约方法失败:', callError);
        console.error('❌ 错误代码:', callError.code);
        console.error('❌ 错误消息:', callError.message);
        console.error('❌ 错误堆栈:', callError.stack);
        
        if (callError.code === 'BAD_DATA' || callError.message?.includes('could not decode')) {
          console.warn('⚠️ 合约调用失败，可能是合约未部署或 ABI 不匹配');
          setContractDeployed(false);
          setRequests([]);
        } else {
          console.error('❌ 调用 getOpenRequests 失败:', callError);
          setRequests([]);
        }
      }
    } catch (error: any) {
      console.error('❌ 加载请求失败:', error);
      console.error('❌ 错误详情:', error.message, error.stack);
      setRequests([]);
    }
  };

  // 创建请求
  const createRequest = async () => {
    if (!reqTitle || !reqDescription || !reqLocation) {
      setToastMessage('请填写完整信息');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    if (!account) {
      setToastMessage('请先连接钱包');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    // 检查 Wave 余额
    const requiredWave = waveCosts[reqHelpType];
    const currentWave = getUserWave(account);
    if (currentWave < requiredWave) {
      setToastMessage(`Wave 余额不足！需要 ${requiredWave} Wave，当前余额 ${currentWave} Wave`);
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    // 钱包签名认证
    if (!provider) {
      setToastMessage('请先连接钱包');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    setLoading(true);
    try {
      // 获取签名者
      const signer = await provider.getSigner();
      
      // 构建签名消息
      const message = `发布互助请求\n\n标题: ${reqTitle}\n描述: ${reqDescription}\n地点: ${reqLocation}\n帮助类型: ${helpTypes[reqHelpType]}\n消耗 Wave: ${requiredWave}\n\n请签名确认发布此请求。`;
      
      // 请求用户签名
      setToastMessage('请在弹出的 MetaMask 窗口中签名确认...');
      let signature: string;
      try {
        signature = await signer.signMessage(message);
        console.log('✅ 签名成功:', signature);
      } catch (signError: any) {
        // 如果用户拒绝了签名请求
        if (signError.code === 4001 || signError.message?.includes('user rejected') || signError.message?.includes('User rejected')) {
          setToastMessage('签名已取消');
          setTimeout(() => setToastMessage(null), 3000);
          setLoading(false);
          return;
        }
        throw signError;
      }
      
      // 签名成功后继续执行
      // TODO: 未来对接合约
      // if (contract) {
      //   const tx = await contract.createRequest(reqTitle, reqDescription, reqLocation, reqHelpType);
      //   await tx.wait();
      // }
      
      // 扣除 Wave（根据帮助类型扣除对应的wave）
      // waveCosts: [2, 5, 3] 对应 ['机场/车站接送', '一日游导览', '沙发客住宿']
      const waveToDeduct = requiredWave; // requiredWave 已经是 waveCosts[reqHelpType]
      
      setHelpState(prevState => {
        const updatedProfiles = { ...prevState.profiles };
        if (!updatedProfiles[account]) {
          updatedProfiles[account] = { address: account, wave: 0 };
        }
        // 本地wave调整：扣除对应的wave（负数表示扣除）
        updatedProfiles[account].wave = (updatedProfiles[account].wave || 0) - waveToDeduct;
        
        // 如果链上也有 wave，需要同时扣除
        if (user) {
          setUser({
            ...user,
            wave: Math.max(0, (user.wave || 0) - waveToDeduct)
          });
        }
        
        return {
          ...prevState,
          profiles: updatedProfiles
        };
      });
      
      // 本地状态：创建新请求
      const newRequest: Request = {
        id: Date.now(), // 临时 ID，未来使用链上 ID
        requester: account,
        title: reqTitle,
        description: reqDescription,
        location: reqLocation,
        timestamp: Math.floor(Date.now() / 1000),
        status: 0,
        helper: '',
        helpType: reqHelpType,
        statusNew: 'OPEN',
        createdAt: Date.now()
      };
      
      setHelpState(prevState => {
        const newState = {
          ...prevState,
          requests: [...prevState.requests, newRequest]
        };
        saveHelpState(newState);
        return newState;
      });
      
      setReqTitle('');
      setReqDescription('');
      setReqLocation('');
      setReqHelpType(0);
      
      // 如果合约已部署，也加载链上请求
      if (contract) {
        await loadRequests(contract);
      }
      
      setToastMessage('✅ 已成功发布');
      setTimeout(() => setToastMessage(null), 3000);
      setCurrentView('dashboard');
    } catch (error: any) {
      console.error('发布失败:', error);
      setToastMessage('发布失败: ' + (error.message || '未知错误'));
      setTimeout(() => setToastMessage(null), 3000);
    }
    setLoading(false);
  };

  // 接受请求
  // ============================================
  // 帮助流程核心函数
  // ============================================
  
  // 接受帮助（点击"帮助"按钮）
  const takeHelp = async (requestId: number, helperAddress: string) => {
    if (!account || account.toLowerCase() !== helperAddress.toLowerCase()) {
      setToastMessage('请先连接钱包');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    
    if (!provider) {
      setToastMessage('请先连接钱包');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    // 钱包签名认证
    try {
      // 获取签名者
      const signer = await provider.getSigner();
      
      // 查找请求信息
      let request = helpState.requests.find(r => r.id === requestId);
      if (!request) {
        request = requests.find(r => r.id === requestId);
      }
      
      if (!request) {
        setToastMessage('未找到请求信息');
        setTimeout(() => setToastMessage(null), 3000);
        return;
      }
      
      // 构建签名消息
      const message = `接受互助请求\n\n请求ID: ${requestId}\n标题: ${request.title}\n地点: ${request.location}\n帮助类型: ${helpTypes[request.helpType]}\n\n请签名确认接受此帮助请求。`;
      
      // 请求用户签名
      setToastMessage('请在弹出的 MetaMask 窗口中签名确认...');
      const signature = await signer.signMessage(message);
      console.log('✅ 签名成功:', signature);
      
      // 签名成功后继续执行
    } catch (signError: any) {
      // 如果用户拒绝了签名请求
      if (signError.code === 4001 || signError.message?.includes('user rejected') || signError.message?.includes('User rejected')) {
        setToastMessage('签名已取消');
        setTimeout(() => setToastMessage(null), 3000);
        return;
      }
      console.error('签名失败:', signError);
      setToastMessage('签名失败: ' + (signError.message || '未知错误'));
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    setHelpState(prevState => {
      const updatedRequests = [...prevState.requests];
      const existingReq = updatedRequests.find(r => r.id === requestId);
      
      if (existingReq) {
        const index = updatedRequests.indexOf(existingReq);
        updatedRequests[index] = {
          ...existingReq,
          helper: helperAddress,
          status: 1,
          statusNew: 'IN_PROGRESS' as RequestStatus,
          createdAt: existingReq.createdAt || existingReq.timestamp || Date.now()
        };
      } else {
        // 从链上请求添加
        const chainReq = requests.find(r => r.id === requestId);
        if (chainReq) {
          updatedRequests.push({
            ...chainReq,
            helper: helperAddress,
            status: 1,
            statusNew: 'IN_PROGRESS' as RequestStatus,
            createdAt: chainReq.timestamp || Date.now()
          });
        }
      }
      
      const newState = { ...prevState, requests: updatedRequests };
      saveHelpState(newState);
      return newState;
    });

    setToastMessage('请移步个人中心查看帮助详情');
    setTimeout(() => setToastMessage(null), 3000);

    // TODO: 未来对接合约
    // try {
    //   const tx = await contract.acceptRequest(requestId);
    //   await tx.wait();
    // } catch (error) {
    //   console.error('链上接受请求失败:', error);
    // }
  };

  // 确认帮助完成
  const confirmHelpCompleted = async (requestId: number, requesterAddress: string) => {
    if (!account || account.toLowerCase() !== requesterAddress.toLowerCase()) {
      setToastMessage('只有求助者可以确认完成');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    if (!provider) {
      setToastMessage('请先连接钱包');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    // 先获取 helperAddress（从 helpState 或链上请求中查找）
    let request = helpState.requests.find(r => r.id === requestId);
    if (!request) {
      request = requests.find(r => r.id === requestId);
    }
    const helperAddress = request?.helper;
    if (!helperAddress) {
      setToastMessage('未找到帮助者信息');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    // 钱包签名认证
    if (!request) {
      setToastMessage('未找到请求信息');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    try {
      // 获取签名者
      const signer = await provider.getSigner();
      
      // 构建签名消息
      const message = `确认帮助完成\n\n请求ID: ${requestId}\n标题: ${request.title}\n帮助者: ${helperAddress.slice(0, 6)}...${helperAddress.slice(-4)}\n\n请签名确认此次帮助已完成。`;
      
      // 请求用户签名
      setToastMessage('请在弹出的 MetaMask 窗口中签名确认...');
      let signature: string;
      try {
        signature = await signer.signMessage(message);
        console.log('✅ 签名成功:', signature);
      } catch (signError: any) {
        // 如果用户拒绝了签名请求
        if (signError.code === 4001 || signError.message?.includes('user rejected') || signError.message?.includes('User rejected')) {
          setToastMessage('签名已取消');
          setTimeout(() => setToastMessage(null), 3000);
          return;
        }
        throw signError;
      }
    } catch (signError: any) {
      console.error('签名失败:', signError);
      setToastMessage('签名失败: ' + (signError.message || '未知错误'));
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }

    setHelpState(prevState => {
      const req = prevState.requests.find(r => r.id === requestId);
      if (!req || req.waveRewarded) {
        return prevState;
      }

      const updatedRequests = prevState.requests.map(r => {
        if (r.id === requestId) {
          return {
            ...r,
            status: 2,
            statusNew: 'COMPLETED' as RequestStatus,
            nftMinted: true,
            waveRewarded: true
          };
        }
        return r;
      });

      const updatedProfiles = { ...prevState.profiles };
      if (!updatedProfiles[helperAddress]) {
        updatedProfiles[helperAddress] = { address: helperAddress, wave: 0 };
      }
      // 帮助者获得 +1 Wave（无论什么类型的帮助）
      updatedProfiles[helperAddress].wave = (updatedProfiles[helperAddress].wave || 0) + 1;

      const newState = { requests: updatedRequests, profiles: updatedProfiles };
      saveHelpState(newState);
      return newState;
    });

    // 更新用户的 totalReceived（被帮助者）和 totalHelps（帮助者）
    // 保存更新前的值，用于合并更新
    const previousRequesterTotalReceived = user?.totalReceived || 0;
    const previousHelperTotalHelps = user?.totalHelps || 0;
    
    // 被帮助者（requesterAddress）的 totalReceived +1
    // 如果被帮助者是当前用户，立即更新前端状态
    if (user && account.toLowerCase() === requesterAddress.toLowerCase()) {
      setUser({
        ...user,
        totalReceived: (user.totalReceived || 0) + 1
      });
    }
    
    // 帮助者（helperAddress）的 totalHelps +1
    // 如果帮助者是当前用户，立即更新前端状态
    if (helperAddress) {
      if (helperAddress.toLowerCase() === account?.toLowerCase()) {
        // 帮助者是当前用户，更新当前用户的帮助次数
        if (user) {
          setUser({
            ...user,
            totalHelps: (user.totalHelps || 0) + 1,
            // 帮助者获得 +1 Wave
            wave: (user.wave || 0) + 1
          });
        }
      }
    }
    
    // 从链上重新加载当前用户的信息，确保统计数据正确更新
    // 只有当受助者或帮助者是当前用户时，才需要重新加载
    // 使用延迟执行，确保前端状态更新完成
    if (contract && account) {
      const isRequesterCurrentUser = requesterAddress.toLowerCase() === account.toLowerCase();
      const isHelperCurrentUser = helperAddress.toLowerCase() === account.toLowerCase();
      
      // 如果受助者或帮助者是当前用户，重新加载当前用户信息
      if (isRequesterCurrentUser || isHelperCurrentUser) {
        setTimeout(async () => {
          try {
            await loadUser(account, contract);
            console.log('✅ 当前用户信息已更新（包含受助/帮助统计）');
          } catch (error) {
            console.warn('⚠️ 加载当前用户信息失败:', error);
          }
        }, 500);
      }
    }

    setToastMessage('✅ 已完成！受帮助次数和帮助次数已更新，帮助者获得 +1 Wave');
    setTimeout(() => setToastMessage(null), 3000);

    // TODO: 未来对接合约
    // try {
    //   const tx = await contract.completeRequest(requestId);
    //   await tx.wait();
    // } catch (error) {
    //   console.error('链上确认完成失败:', error);
    // }
  };

  // 获取互助广场的请求（只显示 OPEN 状态）
  const getRequestsForSquare = (): Request[] => {
    const allRequests = [...requests];
    helpState.requests.forEach(localReq => {
      if (!allRequests.find(r => r.id === localReq.id)) {
        allRequests.push(localReq);
      }
    });

    return allRequests.filter(req => {
      const status = req.statusNew || (req.status === 0 ? 'OPEN' : req.status === 1 ? 'IN_PROGRESS' : 'COMPLETED');
      return status === 'OPEN';
    });
  };

  // 获取个人中心的请求
  const getRequestsForProfile = (address: string) => {
    const allRequests = [...requests, ...helpState.requests];
    const uniqueRequests = Array.from(new Map(allRequests.map(req => [req.id, req])).values());

    return {
      myRequests: uniqueRequests.filter(req => 
        req.requester.toLowerCase() === address.toLowerCase()
      ),
      helpingInProgress: uniqueRequests.filter(req => 
        req.helper.toLowerCase() === address.toLowerCase() && 
        (req.statusNew === 'IN_PROGRESS' || req.status === 1)
      ),
      helpingCompleted: uniqueRequests.filter(req => 
        req.helper.toLowerCase() === address.toLowerCase() && 
        (req.statusNew === 'COMPLETED' || req.status === 2)
      )
    };
  };

  // 获取用户 wave
  const getUserWave = (address: string): number => {
    // 如果查询的是当前用户，使用 user 状态
    if (address.toLowerCase() === account?.toLowerCase() && user) {
      const chainWave = user.wave || 0;
      const localProfile = helpState.profiles[address];
      const localWave = localProfile?.wave || 0;
      // 确保wave不为负数
      return Math.max(0, chainWave + localWave);
    }
    // 如果查询的是其他用户，只使用本地状态
    const localProfile = helpState.profiles[address];
    return localProfile?.wave || 0;
  };

  // 保留原有的 acceptRequest（兼容性，调用新的 takeHelp）
  const acceptRequest = async (requestId: number) => {
    if (!account) {
      setToastMessage('请先连接钱包');
      setTimeout(() => setToastMessage(null), 3000);
      return;
    }
    await takeHelp(requestId, account);
  };

  const helpTypes = ['机场/车站接送', '一日游导览', '沙发客住宿'];
  const waveCosts = [2, 5, 3]; // 对应helpTypes的Wave消耗
  const waveReward = 1; // 接受任务获得的Wave

  return (
    <div className="min-h-screen" style={{ background: '#F5F1E8' }}>
      {/* 导航栏 */}
      <nav className="bg-white/90 backdrop-blur-md border-b sticky top-0 z-50" style={{ borderColor: '#E8D5D5' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-2">
              <h1 className="text-xl brand-herweave">
                <span className="brand-text-dark">Her</span>
                <span className="brand-terracotta">Weave</span>
          </h1>
            </div>
            
            <div className="flex items-center space-x-4">
              {!account ? (
                // 未连接钱包时：只在首页显示"连接钱包"按钮
                currentView === 'home' ? (
                  <button
                    onClick={connectWallet}
                    className="btn-primary"
                    style={{ padding: '10px 24px', fontSize: '16px', minWidth: '120px', textAlign: 'center' }}
                  >
                    连接钱包
                  </button>
                ) : null
              ) : currentView === 'home' ? (
                // 已连接钱包 + 首页：显示钱包地址，点击切换为断开连接
                showDisconnect ? (
                  <button
                    onClick={() => {
                      // 清除定时器
                      if (disconnectTimerRef.current) {
                        clearTimeout(disconnectTimerRef.current);
                        disconnectTimerRef.current = null;
                      }
                      // 执行断开连接
                      setAccount(null);
                      setProvider(null);
                      setContract(null);
                      setUser(null);
                      setRequests([]);
                      setCurrentView('home');
                      setContractDeployed(null);
                      setShowDisconnect(false);
                    }}
                    className="px-3 py-1 rounded-full text-sm font-medium transition-colors hover:opacity-80 cursor-pointer"
                    style={{ background: '#E8D5D5', color: '#A05A48', minWidth: '120px', textAlign: 'center' }}
                  >
                    断开连接
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      // 清除之前的定时器（如果有）
                      if (disconnectTimerRef.current) {
                        clearTimeout(disconnectTimerRef.current);
                        disconnectTimerRef.current = null;
                      }
                      setShowDisconnect(true);
                    }}
                    className="px-3 py-1 rounded-full text-sm cursor-pointer transition-colors hover:opacity-80"
                    style={{ background: '#E8D5D5', color: '#A05A48', minWidth: '120px', textAlign: 'center' }}
                  >
                    {account.slice(0, 6)}...{account.slice(-4)}
                  </button>
                )
              ) : (
                // 已连接钱包 + 非首页：显示完整导航栏（互助请求、发布请求、个人中心、钱包地址）
                <>
                  <button
                    onClick={() => {
                      setCurrentView('dashboard');
                      if (contract) {
                        if (account) loadUser(account, contract);
                        loadRequests(contract);
                      }
                    }}
                    className={`px-4 py-2 rounded-full transition-colors text-sm font-medium ${
                      currentView === 'dashboard' 
                        ? 'text-white' 
                        : 'hover:bg-opacity-10'
                    }`}
                    style={currentView === 'dashboard' ? { backgroundColor: '#C4715E' } : { color: '#5A5A5A' }}
                  >
                    互助广场
                  </button>
                  <button
                    onClick={() => setCurrentView('create')}
                    className={`px-4 py-2 rounded-full transition-colors text-sm font-medium ${
                      currentView === 'create' 
                        ? 'text-white' 
                        : 'hover:bg-opacity-10'
                    }`}
                    style={currentView === 'create' ? { backgroundColor: '#C4715E' } : { color: '#5A5A5A' }}
                  >
                    发布请求
                  </button>
                  <button
                    onClick={() => {
                      setCurrentView('profile');
                      if (contract && account) loadUser(account, contract);
                    }}
                    className={`px-4 py-2 rounded-full transition-colors text-sm font-medium ${
                      currentView === 'profile' 
                        ? 'text-white' 
                        : 'hover:bg-opacity-10'
                    }`}
                    style={currentView === 'profile' ? { backgroundColor: '#C4715E' } : { color: '#5A5A5A' }}
                  >
                    个人中心
                  </button>
                  {showDisconnect ? (
                    <button
                      onClick={() => {
                        // 清除定时器
                        if (disconnectTimerRef.current) {
                          clearTimeout(disconnectTimerRef.current);
                          disconnectTimerRef.current = null;
                        }
                        // 执行断开连接
                        setAccount(null);
                        setProvider(null);
                        setContract(null);
                        setUser(null);
                        setRequests([]);
                        setCurrentView('home');
                        setContractDeployed(null);
                        setShowDisconnect(false);
                      }}
                      className="px-3 py-1 rounded-full text-sm font-medium transition-colors hover:opacity-80 cursor-pointer"
                      style={{ background: '#E8D5D5', color: '#A05A48', minWidth: '120px', textAlign: 'center' }}
                    >
                      断开连接
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        // 清除之前的定时器（如果有）
                        if (disconnectTimerRef.current) {
                          clearTimeout(disconnectTimerRef.current);
                          disconnectTimerRef.current = null;
                        }
                        setShowDisconnect(true);
                      }}
                      className="px-3 py-1 rounded-full text-sm cursor-pointer transition-colors hover:opacity-80"
                      style={{ background: '#E8D5D5', color: '#A05A48', minWidth: '120px', textAlign: 'center' }}
                    >
                      {account.slice(0, 6)}...{account.slice(-4)}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* 主内容区 */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" style={{ paddingTop: currentView === 'home' ? '0' : '2rem', paddingBottom: '2rem' }}>
        {/* 合约未部署提示 */}
        {account && contractDeployed === false && (
          <div className="mb-6 card" style={{ borderLeft: '4px solid #D4A5A5', background: '#FFFFFF' }}>
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <span className="text-2xl">⚠️</span>
              </div>
              <div className="ml-3">
                <h3 className="text-h3 mb-2" style={{ color: '#A05A48' }}>
                  智能合约未部署或网络不匹配
                </h3>
                <div className="mt-2 text-body">
                  <p style={{ color: '#5A5A5A' }}>请确保：</p>
                  <ol className="list-decimal list-inside mt-1 space-y-1 text-body" style={{ color: '#5A5A5A' }}>
                    <li>MetaMask 已连接到 <code className="px-1 rounded" style={{ background: '#E8D5D5', color: '#A05A48' }}>localhost:8545</code> 网络</li>
                    <li>已运行 <code className="px-1 rounded" style={{ background: '#E8D5D5', color: '#A05A48' }}>npx hardhat node</code> 启动本地测试网络</li>
                    <li>已运行 <code className="px-1 rounded" style={{ background: '#E8D5D5', color: '#A05A48' }}>npx hardhat run scripts/deploy.js --network localhost</code> 部署合约</li>
                    <li>合约地址 <code className="px-1 rounded" style={{ background: '#E8D5D5', color: '#A05A48' }}>{CONTRACT_ADDRESS}</code> 正确</li>
                  </ol>
                  <p className="mt-2 text-body" style={{ color: '#5A5A5A' }}>💡 提示：如果已部署，请检查浏览器控制台的日志信息。</p>
                  <button
                    onClick={async () => {
                      if (provider) {
                        await checkContractDeployed(provider);
                        if (contract && account) {
                          await loadUser(account, contract);
                          await loadRequests(contract);
                        }
                      }
                    }}
                    className="mt-3 btn-secondary text-sm"
                    style={{ padding: '8px 20px' }}
                  >
                    重新检查合约状态
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        
        {(!account || (account && currentView === 'home')) ? (
          // 未连接钱包或点击首页 - 显示欢迎页面
          <div className="relative w-full" style={{ background: '#F5F1E8' }}>
            {/* 第一页 - 主页内容 */}
            <div className="relative min-h-screen flex items-start justify-center px-6 md:px-12 lg:px-20 overflow-hidden pt-24">
            {/* 背景装饰 - 渐变光晕 */}
            <div 
              className="absolute top-0 right-0 w-96 h-96 rounded-full opacity-20 blur-3xl"
              style={{ 
                background: 'radial-gradient(circle, rgba(196, 113, 94, 0.4) 0%, transparent 70%)',
                transform: 'translate(30%, -30%)'
              }}
            ></div>
            <div 
              className="absolute bottom-0 left-0 w-80 h-80 rounded-full opacity-15 blur-3xl"
              style={{ 
                background: 'radial-gradient(circle, rgba(212, 165, 165, 0.3) 0%, transparent 70%)',
                transform: 'translate(-30%, 30%)'
              }}
            ></div>

            {/* 世界地图和热点城市 */}
            <div className="absolute inset-0 w-full h-full opacity-30" style={{ pointerEvents: 'none' }}>
              <svg
                viewBox="0 0 100 100"
                className="w-full h-full"
                preserveAspectRatio="xMidYMid slice"
                onMouseMove={handleHomeNodeMouseMove}
                onMouseUp={handleHomeNodeMouseUp}
                onMouseLeave={handleHomeNodeMouseUp}
                style={{ cursor: draggingHomeNode ? 'grabbing' : 'default', pointerEvents: 'auto' }}
              >
                <defs>
                  {/* 发光效果 */}
                  <filter id="cityGlow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="0.5" result="coloredBlur" />
                    <feMerge>
                      <feMergeNode in="coloredBlur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>

                  {/* 柔和发光 */}
                  <filter id="softCityGlow" x="-100%" y="-100%" width="300%" height="300%">
                    <feGaussianBlur stdDeviation="1.5" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>

                  {/* 脉冲渐变 - 更柔和的灰粉色 */}
                  <radialGradient id="pulseGradient">
                    <stop offset="0%" stopColor="#D4A5A5" stopOpacity="0.3" />
                    <stop offset="50%" stopColor="#D4A5A5" stopOpacity="0.15" />
                    <stop offset="100%" stopColor="#D4A5A5" stopOpacity="0" />
                  </radialGradient>

                  {/* 线条渐变 */}
                  <linearGradient id="threadGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#D4A5A5" stopOpacity="0" />
                    <stop offset="50%" stopColor="#D4A5A5" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#D4A5A5" stopOpacity="0" />
                  </linearGradient>
                </defs>


                {/* 编织线程 - 动态连接 */}
                <g className="weave-threads">
                  {threads.map((thread) => (
                    <g key={thread.id}>
                      {/* 主线条 */}
                      <line
                        x1={thread.from.x}
                        y1={thread.from.y}
                        x2={thread.to.x}
                        y2={thread.to.y}
                        stroke="url(#threadGradient)"
                        strokeWidth="0.15"
                        className="thread-line"
                        style={{
                          animation: `threadPulse ${thread.duration}s ease-in-out infinite`,
                          animationDelay: `${thread.delay}s`,
                        }}
                      />
                    </g>
                  ))}
                </g>

                {/* 城市热点 */}
                <g className="city-hotspots">
                  {homeHotspots.map((city, index) => {
                    const size = 1.2;
                    const isHovered = hoveredCity === city.label;
                    const isDragging = draggingHomeNode === city.label;
                    
                    // 如果正在拖拽，应用偏移量
                    let cityX = city.x;
                    let cityY = city.y;
                    if (isDragging && homeDragOffset) {
                      cityX += homeDragOffset.x;
                      cityY += homeDragOffset.y;
                    }
                    
                    return (
                      <g 
                        key={city.label}
                        className="city-point"
                        onMouseEnter={() => !isDragging && setHoveredCity(city.label)}
                        onMouseLeave={() => !isDragging && setHoveredCity(null)}
                        style={{ pointerEvents: 'auto' }}
                      >
                        {/* 外圈脉冲 - 更柔和 */}
                        <circle
                          cx={cityX}
                          cy={cityY}
                          r={size * 2.5}
                          fill="none"
                          stroke="#D4A5A5"
                          strokeWidth="0.3"
                          opacity="0.4"
                          className="pulse-ring"
                          style={{
                            animation: isDragging ? 'none' : `pulse 3s ease-out infinite`,
                            animationDelay: `${index * 0.4}s`,
                            transformOrigin: `${cityX}px ${cityY}px`,
                            pointerEvents: 'none'
                          }}
                        />
                        
                        {/* 柔和光晕 */}
                        <circle
                          cx={cityX}
                          cy={cityY}
                          r={size * 1.8}
                          fill="#D4A5A5"
                          opacity="0.15"
                          filter="url(#softCityGlow)"
                          style={{ pointerEvents: 'none' }}
                        />
                        
                        {/* 中间层 - 灰粉色 */}
                        <circle
                          cx={cityX}
                          cy={cityY}
                          r={size * 0.8}
                          fill="#D4A5A5"
                          opacity="0.4"
                          style={{ pointerEvents: 'none' }}
                        />
                        
                        {/* 核心点 - 更小更精致 */}
                        <circle
                          cx={cityX}
                          cy={cityY}
                          r={isHovered ? size * 0.4 : size * 0.25}
                          fill="#C4715E"
                          opacity="0.6"
                          filter="url(#cityGlow)"
                          className={isDragging ? '' : 'transition-all duration-300'}
                          style={{ 
                            cursor: isDragging ? 'grabbing' : 'grab',
                            pointerEvents: 'auto'
                          }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            handleHomeNodeMouseDown(e, city);
                          }}
                        />
                      </g>
                    );
                  })}
                </g>
              </svg>

              {/* Hover 城市标签 */}
              {hoveredCity && !draggingHomeNode && (
                <div 
                  className="absolute pointer-events-none z-20 px-3 py-2 rounded-full backdrop-blur-sm border shadow-lg"
                  style={{
                    left: `${(homeHotspots.find(c => c.label === hoveredCity)?.x || 50)}%`,
                    top: `${(homeHotspots.find(c => c.label === hoveredCity)?.y || 50) - 8}%`,
                    transform: 'translate(-50%, -100%)',
                    background: 'rgba(255, 255, 255, 0.9)',
                    borderColor: '#D4A5A5',
                    color: '#2C2C2C',
                    pointerEvents: 'none'
                  }}
                >
                  <span className="text-sm font-medium">{hoveredCity}</span>
                </div>
              )}

              {/* CSS 动画 */}
              <style>{`
                @keyframes pulse {
                  0% {
                    transform: scale(0.8);
                    opacity: 0.8;
                  }
                  50% {
                    transform: scale(1.2);
                    opacity: 0.4;
                  }
                  100% {
                    transform: scale(1.5);
                    opacity: 0;
                  }
                }
                
                @keyframes threadPulse {
                  0%, 100% {
                    opacity: 0.15;
                  }
                  50% {
                    opacity: 0.4;
                  }
                }
                
                .thread-line {
                  stroke-dasharray: 2 2;
                  animation: dash 20s linear infinite;
                }
                
                @keyframes dash {
                  to {
                    stroke-dashoffset: -100;
                  }
                }
              `}</style>
            </div>

            <div className="relative z-10 w-full max-w-7xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
              {/* 左侧 - Logo区域 */}
              <div className="flex flex-col items-center lg:items-start">
                <div 
                  className="mb-6 lg:mb-8 p-6 rounded-2xl"
                  style={{ 
                    background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.5) 100%)',
                    backdropFilter: 'blur(10px)',
                    border: '2px solid rgba(196, 113, 94, 0.3)',
                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08), 0 4px 12px rgba(196, 113, 94, 0.15)'
                  }}
                >
                  <img 
                    src="/HerWeave.png" 
                    alt="HerWeave Logo" 
                    style={{ 
                      width: '450px',
                      height: 'auto',
                      maxWidth: '100%',
                      display: 'block'
                    }}
                  />
                </div>
              </div>

              {/* 右侧 - 内容区域 */}
              <div className="flex flex-col space-y-6 lg:space-y-8">
                {/* 品牌名称 */}
                <h1 
                  className="text-6xl md:text-7xl lg:text-8xl font-medium leading-tight"
                  style={{ 
                    letterSpacing: '-0.03em',
                    background: 'linear-gradient(135deg, #C4715E 0%, #A05A48 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text'
                  }}
                >
                  HerWeave
          </h1>

                {/* 主标语 */}
                <div className="space-y-3">
                  <p 
                    className="text-3xl md:text-4xl lg:text-5xl font-semibold leading-tight whitespace-nowrap"
                    style={{ 
                      letterSpacing: '0.02em'
                    }}
                  >
                    <span
                      style={{
                        background: 'linear-gradient(135deg, #E53E3E 0%, #C4715E 50%, #A05A48 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        fontWeight: '600'
                      }}
                    >
                      Her Weave
                    </span>
                    <span style={{ color: '#8A8A8A', margin: '0 8px', fontWeight: '300' }}>,</span>
                    <span
                      style={{
                        background: 'linear-gradient(135deg, #A05A48 0%, #8B4A3A 100%)',
                        WebkitBackgroundClip: 'text',
                        WebkitTextFillColor: 'transparent',
                        backgroundClip: 'text',
                        fontWeight: '500'
                      }}
                    >
                      Your World
                    </span>
          </p>
        </div>

                {/* 描述文字 */}
                <p 
                  className="text-lg md:text-xl leading-relaxed max-w-lg"
                  style={{ color: '#8A8A8A' }}
                >
                  基于 Web3 信任机制的女性旅行互助网络，让女性在跨国旅行中可以彼此支持、互相交换帮助，缓解独自旅行时的信息差与安全信任问题。
                </p>

                {/* 主要按钮 - 静态文本 */}
                {!account ? (
                  <div className="pt-2">
                    <div
                      className="text-lg px-8 py-3.5"
                      style={{ 
                        fontSize: '18px',
                        padding: '16px 48px',
                        color: '#FFFFFF',
                        fontWeight: '500',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        border: '2px solid #C4715E',
                        borderRadius: '50px',
                        display: 'inline-block',
                        background: '#C4715E'
                      }}
                    >
                      开始你的旅程
                    </div>
                  </div>
                ) : (
                  <div className="pt-2">
                    <div
                      className="text-lg px-8 py-3.5"
                      style={{ 
                        fontSize: '18px',
                        padding: '16px 48px',
                        color: '#FFFFFF',
                        fontWeight: '500',
                        pointerEvents: 'none',
                        userSelect: 'none',
                        border: '2px solid #C4715E',
                        borderRadius: '50px',
                        display: 'inline-block',
                        background: '#C4715E'
                      }}
                    >
                      开始你的旅程
                    </div>
                  </div>
                )}

                {/* 服务选项 - 横向排列 */}
                <div className="grid grid-cols-3 gap-4 pt-4">
                  <div 
                    className="flex flex-row items-center gap-2 p-4 rounded-lg transition-all duration-300 cursor-pointer"
                    style={{ 
                      background: 'rgba(255, 255, 255, 0.3)',
                      border: '1px solid rgba(212, 165, 165, 0.2)'
                    }}
                  >
                    <div className="text-3xl">
                      🛏️
                    </div>
                    <p 
                      className="text-base font-normal"
                      style={{ color: '#5A5A5A' }}
                    >
                      借住一晚
                    </p>
                  </div>
                  <div 
                    className="flex flex-row items-center gap-2 p-4 rounded-lg transition-all duration-300 cursor-pointer"
                    style={{ 
                      background: 'rgba(255, 255, 255, 0.3)',
                      border: '1px solid rgba(212, 165, 165, 0.2)'
                    }}
                  >
                    <div className="text-3xl">
                      🏛️
                    </div>
                    <p 
                      className="text-base font-normal"
                      style={{ color: '#5A5A5A' }}
                    >
                      一起探索
                    </p>
                  </div>
                  <div 
                    className="flex flex-row items-center gap-2 p-4 rounded-lg transition-all duration-300 cursor-pointer relative"
                    style={{ 
                      background: 'rgba(255, 255, 255, 0.3)',
                      border: '1px solid rgba(212, 165, 165, 0.2)'
                    }}
                  >
                    <div className="text-3xl">
                      🚗
                    </div>
                    <p 
                      className="text-base font-normal"
                      style={{ color: '#5A5A5A' }}
                    >
                      接送一程
                    </p>
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>
        ) : currentView === 'dashboard' ? (
          // 已连接 - 互助广场页面
          <div>
            {/* 标题和描述 */}
            <div className="mb-6">
              <h2 
                className="text-3xl md:text-4xl font-bold text-center mb-4"
                style={{ color: '#A05A48' }}
              >
                你需要什么帮助？你可以帮助谁？
              </h2>
              <p 
                className="text-base md:text-lg text-center max-w-2xl mx-auto leading-relaxed"
                style={{ color: '#5A5A5A' }}
              >
                发出你的需求,等待附近的姐妹接下任务。每一次帮助,都是网络中新的一根线。
              </p>
            </div>

            {/* SVG 世界节点网络图 */}
            <div className="mb-12" style={{ marginTop: '-2rem' }}>
              <div 
                ref={networkContainerRef}
                className="relative w-full rounded-2xl overflow-hidden"
                style={{ 
                  background: 'transparent',
                  border: 'none',
                  minHeight: '500px',
                  height: '60vh',
                  maxHeight: '800px'
                }}
                onClick={(e) => {
                  // 点击空白处关闭卡片
                  if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'svg') {
                    setSelectedNode(null);
                    setCardPosition(null);
                  }
                }}
              >
                <svg
                  viewBox="0 0 1000 500"
                  className="w-full h-full"
                  preserveAspectRatio="xMidYMid meet"
                  style={{ cursor: 'default' }}
                >
                  {/* 地图背景图片 - 最底层 */}
                  <image
                    href="/map.png"
                    x="0"
                    y="0"
                    width="1000"
                    height="500"
                    preserveAspectRatio="xMidYMid meet"
                    opacity="0.6"
                    style={{ pointerEvents: 'none' }}
                  />

                  <defs>
                    {/* 节点发光效果 */}
                    <filter id="nodeGlow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="0.3" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    {/* 选中节点高亮 */}
                    <filter id="nodeGlowSelected" x="-100%" y="-100%" width="300%" height="300%">
                      <feGaussianBlur stdDeviation="0.8" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    {/* 城市发光效果（用于节点动态效果） */}
                    <filter id="cityGlow" x="-50%" y="-50%" width="200%" height="200%">
                      <feGaussianBlur stdDeviation="0.5" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                    {/* 柔和发光 */}
                    <filter id="softCityGlow" x="-100%" y="-100%" width="300%" height="300%">
                      <feGaussianBlur stdDeviation="1.5" result="blur" />
                      <feComposite in="SourceGraphic" in2="blur" operator="over" />
                    </filter>
                    {/* 脉冲渐变 */}
                    <radialGradient id="pulseGradient">
                      <stop offset="0%" stopColor="#D4A5A5" stopOpacity="0.3" />
                      <stop offset="50%" stopColor="#D4A5A5" stopOpacity="0.15" />
                      <stop offset="100%" stopColor="#D4A5A5" stopOpacity="0" />
                    </radialGradient>
                    {/* 连接线渐变 */}
                    <linearGradient id="edgeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#E53E3E" stopOpacity={LINE_OPACITY * 0.9} />
                      <stop offset="50%" stopColor="#E53E3E" stopOpacity={LINE_OPACITY} />
                      <stop offset="100%" stopColor="#E53E3E" stopOpacity={LINE_OPACITY * 0.9} />
                    </linearGradient>
                  </defs>

                  {/* 连接线和节点 - 只在map.png加载完成后显示 */}
                  {mapImageLoaded && (
                    <>
                      {/* 连接线 */}
                      <g className="network-edges">
                        {networkEdges.map((edge, idx) => {
                          const fromNode = nodes.find(n => n.id === edge.from);
                          const toNode = nodes.find(n => n.id === edge.to);
                          if (!fromNode || !toNode) return null;
                          
                          // 将百分比坐标转换为 viewBox 坐标 (0-100 -> 0-1000, 0-500)
                          const fromX = (fromNode.x / 100) * 1000;
                          const fromY = (fromNode.y / 100) * 500;
                          const toX = (toNode.x / 100) * 1000;
                          const toY = (toNode.y / 100) * 500;
                          
                          const isSelected = selectedNode && (selectedNode.id === fromNode.id || selectedNode.id === toNode.id);
                          
                          return (
                            <line
                              key={`${edge.from}-${edge.to}-${idx}`}
                              x1={fromX}
                              y1={fromY}
                              x2={toX}
                              y2={toY}
                              stroke={isSelected ? '#C53030' : 'url(#edgeGradient)'}
                              strokeWidth={isSelected ? '2.5' : '1.5'}
                              strokeDasharray="4 3"
                              opacity={isSelected ? LINE_OPACITY_SELECTED : LINE_OPACITY}
                              style={{ transition: 'all 0.3s ease' }}
                            />
                          );
                        })}
                      </g>

                      {/* 节点 */}
                      <g className="network-nodes">
                      {nodes.map((node) => {
                      const isSelected = selectedNode?.id === node.id;
                      const isConnected = selectedNode && networkEdges.some(
                        e => (e.from === node.id && e.to === selectedNode.id) || 
                             (e.to === node.id && e.from === selectedNode.id)
                      );
                      const isDragging = draggingNode === node.id;
                      
                      // 将百分比坐标转换为 viewBox 坐标 (0-100 -> 0-1000, 0-500)
                      let nodeX = (node.x / 100) * 1000;
                      let nodeY = (node.y / 100) * 500;
                      
                      // 如果正在拖拽，应用偏移量
                      if (isDragging && dragOffset) {
                        nodeX += dragOffset.x;
                        nodeY += dragOffset.y;
                      }
                      
                      const nodeIndex = nodes.findIndex(n => n.id === node.id);
                      // 首页节点 size = 1.2，在 viewBox 0-100 中
                      // 互助广场 viewBox 是 0-1000，所以需要放大 10 倍
                      // 但考虑到视觉效果，使用 1.2 * 8 = 9.6 作为基础大小
                      const nodeSize = 9.6;
                      
                      return (
                        <g key={node.id}>
                          {/* 外圈脉冲动画 */}
                          <circle
                            cx={nodeX}
                            cy={nodeY}
                            r={nodeSize * 2.5}
                            fill="none"
                            stroke="#E53E3E"
                            strokeWidth="0.5"
                            opacity="0.5"
                            className="pulse-ring"
                            style={{
                              animation: `pulse 3s ease-out infinite`,
                              animationDelay: `${nodeIndex * 0.4}s`,
                              transformOrigin: `${nodeX}px ${nodeY}px`,
                              pointerEvents: 'none'
                            }}
                          />
                          
                          {/* 柔和光晕 */}
                          <circle
                            cx={nodeX}
                            cy={nodeY}
                            r={nodeSize * 1.8}
                            fill="#E53E3E"
                            opacity="0.25"
                            filter="url(#softCityGlow)"
                            style={{ pointerEvents: 'none' }}
                          />
                          
                          {/* 中间层 - 红色 */}
                          <circle
                            cx={nodeX}
                            cy={nodeY}
                            r={nodeSize * 0.8}
                            fill="#E53E3E"
                            opacity="0.5"
                            style={{ pointerEvents: 'none' }}
                          />
                          
                          {/* 核心点 */}
                          <circle
                            cx={nodeX}
                            cy={nodeY}
                            r={isSelected ? nodeSize * 0.4 : nodeSize * 0.25}
                            fill={isSelected ? '#C53030' : '#E53E3E'}
                            opacity={isSelected ? 0.9 : 0.7}
                            filter="url(#cityGlow)"
                            style={{ 
                              cursor: 'pointer',
                              transition: 'all 0.3s ease',
                              transformOrigin: `${nodeX}px ${nodeY}px`
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              const container = networkContainerRef.current;
                              if (container) {
                                const rect = container.getBoundingClientRect();
                                const scaleX = rect.width / 1000;
                                const scaleY = rect.height / 500;
                                const svgX = nodeX * scaleX;
                                const svgY = nodeY * scaleY;
                                // 气泡显示在节点上方，居中
                                let cardX = svgX;
                                let cardY = svgY - 50; // 节点上方50px
                                // 确保气泡不超出容器边界
                                if (cardX < 0) cardX = 10;
                                if (cardX > rect.width - 200) cardX = rect.width - 210;
                                if (cardY < 0) cardY = svgY + 30; // 如果上方空间不够，显示在下方
                                setCardPosition({ x: cardX, y: cardY });
                              }
                              setSelectedNode(node);
                            }}
                            onMouseEnter={(e) => {
                              if (!selectedNode) {
                                e.currentTarget.style.opacity = '1';
                                e.currentTarget.setAttribute('r', String(nodeSize * 0.4));
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!selectedNode || selectedNode.id !== node.id) {
                                e.currentTarget.style.opacity = String(isSelected ? 0.9 : 0.7);
                                e.currentTarget.setAttribute('r', String(isSelected ? nodeSize * 0.4 : nodeSize * 0.25));
                              }
                            }}
                          />
                        </g>
                        );
                      })}
                      </g>
                    </>
                  )}
                </svg>

                {/* CSS 动画 */}
                <style jsx>{`
                  @keyframes pulse {
                    0% {
                      transform: scale(0.8);
                      opacity: 0.8;
                    }
                    50% {
                      transform: scale(1.2);
                      opacity: 0.4;
                    }
                    100% {
                      transform: scale(1.5);
                      opacity: 0;
                    }
                  }
                `}</style>

                {/* 信息卡片 - 气泡样式 */}
                {selectedNode && cardPosition && (
                  <div
                    className="absolute z-10 animate-in fade-in slide-in-from-top-2"
                    style={{
                      left: `${cardPosition.x}px`,
                      top: `${cardPosition.y}px`,
                      transform: 'translateX(-50%)', // 居中
                      pointerEvents: 'auto'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* 气泡主体 */}
                    <div
                      style={{
                        position: 'relative',
                        padding: '12px 20px',
                        borderRadius: '20px',
                        background: '#A05A48',
                        color: '#FFFFFF',
                        fontSize: '16px',
                        fontWeight: '500',
                        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      {selectedNode.city} · {selectedNode.memberCount ?? 0}位姐妹
                      
                      {/* 三角形指针 - 指向下方节点 */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: '-8px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: 0,
                          height: 0,
                          borderLeft: '8px solid transparent',
                          borderRight: '8px solid transparent',
                          borderTop: '8px solid #A05A48'
                        }}
                      />
        </div>
                  </div>
                )}
              </div>
            </div>

            {(() => {
              const squareRequests = getRequestsForSquare();
              return squareRequests.length === 0 ? (
                <p className="text-body text-center mb-12" style={{ color: '#8A8A8A' }}>暂无</p>
              ) : (
                <div className="grid md:grid-cols-2 gap-4 mb-12">
                  {squareRequests.map((req) => {
                    const status = req.statusNew || (req.status === 0 ? 'OPEN' : req.status === 1 ? 'IN_PROGRESS' : 'COMPLETED');
                    const isRequester = account && req.requester.toLowerCase() === account.toLowerCase();
                    const isHelper = account && req.helper && req.helper.toLowerCase() === account.toLowerCase();
                    
                    return (
                      <div key={req.id} className="card relative">
                        
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="text-h3" style={{ color: '#2C2C2C' }}>{req.title}</h4>
                          <span className="px-2 py-1 rounded-full text-sm font-medium" style={{ background: '#E8D5D5', color: '#A05A48' }}>
                            {helpTypes[req.helpType]}
                          </span>
                        </div>
                        <p className="text-body mb-3 line-clamp-2" style={{ color: '#5A5A5A' }}>{req.description}</p>
                        <div className="flex items-center text-caption mb-3" style={{ color: '#8A8A8A' }}>
                          <span>📍 {req.location}</span>
                        </div>
                        
                        {/* 按钮逻辑 */}
                        {status === 'OPEN' && !isRequester && (
                          <button
                            onClick={() => account ? takeHelp(req.id, account) : setToastMessage('请先连接钱包')}
                            disabled={!account || loading}
                            className="btn-primary disabled:opacity-50 w-full"
                          >
                            {loading ? '处理中...' : '帮助'}
                          </button>
                        )}
                        {status === 'IN_PROGRESS' && (
                          <div className="space-y-2">
                            <button
                              disabled
                              className="btn-secondary w-full opacity-60"
                            >
                              进行中
                            </button>
                            {isRequester && (
                              <button
                                onClick={() => confirmHelpCompleted(req.id, req.requester)}
                                className="btn-primary w-full"
                              >
                                已被成功帮助
                              </button>
                            )}
                          </div>
                        )}
                        {status === 'COMPLETED' && (
                          <button
                            disabled
                            className="btn-secondary w-full opacity-60"
                          >
                            已完成
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}

            {/* 互助任务部分 */}
            <div className="relative w-full py-16 px-6 md:px-12 lg:px-20" style={{ background: '#F5F1E8', marginTop: '3rem' }}>
              <div className="max-w-7xl mx-auto">
                {/* 服务卡片 */}
                <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto">
                  {/* 卡片1 - 沙发客 */}
                  <div 
                    className="rounded-2xl p-6 relative overflow-hidden transition-all duration-300 hover:shadow-lg cursor-pointer flex flex-col"
                    style={{ 
                      background: '#F5F1E8',
                      border: '1px solid rgba(196, 113, 94, 0.2)'
                    }}
                  >
                    {/* 图标框 */}
                    <div 
                      className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.6)',
                        border: '1px solid rgba(196, 113, 94, 0.3)'
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ color: '#C4715E' }}>
                        <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M9 22V12H15V22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    
                    {/* 标题 */}
                    <h3 
                      className="text-xl font-semibold mb-1"
                      style={{ color: '#A05A48' }}
                    >
                      沙发客
                    </h3>
                    
                    {/* 英文副标题 */}
                    <p 
                      className="text-xs font-medium mb-3 uppercase tracking-wider"
                      style={{ color: '#C4715E' }}
                    >
                      COUCH SURFING
                    </p>
                    
                    {/* 描述 */}
                    <p 
                      className="text-sm mb-6 leading-relaxed flex-grow"
                      style={{ color: '#5A5A5A' }}
                    >
                      在姐妹家借住一晚,感受当地生活的温度
                    </p>
                    
                    {/* 底部信息 */}
                    <div className="flex items-center justify-between mt-auto">
                      <div 
                        className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{ background: '#E8D5D5', color: '#A05A48' }}
                      >
                        消耗 3 Wave
                      </div>
                      <span 
                        className="text-xs"
                        style={{ color: '#8A8A8A' }}
                      >
                        48个活跃请求
                      </span>
                    </div>
                  </div>

                  {/* 卡片2 - 一日游向导 */}
                  <div 
                    className="rounded-2xl p-6 relative overflow-hidden transition-all duration-300 hover:shadow-lg cursor-pointer flex flex-col"
                    style={{ 
                      background: '#F5F1E8',
                      border: '1px solid rgba(196, 113, 94, 0.2)'
                    }}
                  >
                    {/* 图标框 */}
                    <div 
                      className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.6)',
                        border: '1px solid rgba(196, 113, 94, 0.3)'
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ color: '#C4715E' }}>
                        <path d="M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 7.61305 3.94821 5.32387 5.63604 3.63604C7.32387 1.94821 9.61305 1 12 1C14.3869 1 16.6761 1.94821 18.364 3.63604C20.0518 5.32387 21 7.61305 21 10Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M12 13C13.6569 13 15 11.6569 15 10C15 8.34315 13.6569 7 12 7C10.3431 7 9 8.34315 9 10C9 11.6569 10.3431 13 12 13Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    
                    {/* 标题 */}
                    <h3 
                      className="text-xl font-semibold mb-1"
                      style={{ color: '#A05A48' }}
                    >
                      一日游向导
                    </h3>
                    
                    {/* 英文副标题 */}
                    <p 
                      className="text-xs font-medium mb-3 uppercase tracking-wider"
                      style={{ color: '#C4715E' }}
                    >
                      LOCAL GUIDE
                    </p>
                    
                    {/* 描述 */}
                    <p 
                      className="text-sm mb-6 leading-relaxed flex-grow"
                      style={{ color: '#5A5A5A' }}
                    >
                      由当地姐妹带你探索那些只有本地人知道的角落
                    </p>
                    
                    {/* 底部信息 */}
                    <div className="flex items-center justify-between mt-auto">
                      <div 
                        className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{ background: '#E8D5D5', color: '#A05A48' }}
                      >
                        消耗 5 Wave
                      </div>
                      <span 
                        className="text-xs"
                        style={{ color: '#8A8A8A' }}
                      >
                        126个活跃请求
                      </span>
                    </div>
                  </div>

                  {/* 卡片3 - 接送机 */}
                  <div 
                    className="rounded-2xl p-6 relative overflow-hidden transition-all duration-300 hover:shadow-lg cursor-pointer flex flex-col"
                    style={{ 
                      background: '#F5F1E8',
                      border: '1px solid rgba(196, 113, 94, 0.2)'
                    }}
                  >
                    {/* 图标框 */}
                    <div 
                      className="w-12 h-12 rounded-lg flex items-center justify-center mb-4"
                      style={{ 
                        background: 'rgba(255, 255, 255, 0.6)',
                        border: '1px solid rgba(196, 113, 94, 0.3)'
                      }}
                    >
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{ color: '#C4715E' }}>
                        <path d="M5 17H19L17 19H7L5 17Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M7 13H17L19 11H5L7 13Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M3 9H21L19 7H5L3 9Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        <circle cx="7" cy="17" r="1" fill="currentColor"/>
                        <circle cx="17" cy="17" r="1" fill="currentColor"/>
                      </svg>
                    </div>
                    
                    {/* 标题 */}
                    <h3 
                      className="text-xl font-semibold mb-1"
                      style={{ color: '#A05A48' }}
                    >
                      接送机
                    </h3>
                    
                    {/* 英文副标题 */}
                    <p 
                      className="text-xs font-medium mb-3 uppercase tracking-wider"
                      style={{ color: '#C4715E' }}
                    >
                      AIRPORT PICKUP
                    </p>
                    
                    {/* 描述 */}
                    <p 
                      className="text-sm mb-6 leading-relaxed flex-grow"
                      style={{ color: '#5A5A5A' }}
                    >
                      初到陌生城市,有人在出口等你
                    </p>
                    
                    {/* 底部信息 */}
                    <div className="flex items-center justify-between mt-auto">
                      <div 
                        className="px-3 py-1 rounded-full text-xs font-medium"
                        style={{ background: '#E8D5D5', color: '#A05A48' }}
                      >
                        消耗 2 Wave
                      </div>
                      <span 
                        className="text-xs"
                        style={{ color: '#8A8A8A' }}
                      >
                        35个活跃请求
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : currentView === 'requests' ? (
          // 请求列表
          <div>
            <h2 className="text-h1 mb-6" style={{ color: '#2C2C2C' }}>互助请求</h2>
            {requests.length === 0 ? (
              <div className="card p-12 text-center">
                <div className="text-6xl mb-4">📭</div>
                <p className="text-body" style={{ color: '#5A5A5A' }}>暂无开放的互助请求</p>
              </div>
            ) : (
              <div className="space-y-4">
                {requests.map((req) => (
                  <div key={req.id} className="card">
                    <div className="flex justify-between items-start mb-4">
                      <div>
                        <h3 className="text-h2 mb-2" style={{ color: '#2C2C2C' }}>{req.title}</h3>
                        <p className="text-body mb-3" style={{ color: '#5A5A5A' }}>{req.description}</p>
                        <div className="flex items-center gap-4 text-caption" style={{ color: '#8A8A8A' }}>
                          <span>📍 {req.location}</span>
                          <span>🏷️ {helpTypes[req.helpType]}</span>
                          <span>⏰ {new Date(Number(req.timestamp) * 1000).toLocaleString('zh-CN')}</span>
                        </div>
                      </div>
                      <span className="px-3 py-1 rounded-full text-sm font-medium" style={{ background: '#E8D5D5', color: '#A05A48' }}>
                        开放中
                      </span>
                    </div>
                    {req.requester.toLowerCase() !== account?.toLowerCase() && (
                      <button
                        onClick={() => acceptRequest(req.id)}
                        disabled={loading}
                        className="btn-primary disabled:opacity-50"
                      >
                        {loading ? '处理中...' : '提供帮助'}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : currentView === 'create' ? (
          // 创建请求
          <div className="max-w-2xl mx-auto">
            <div className="card p-8">
              <div className="space-y-6">
                <div>
                  <label className="block text-caption font-medium mb-2" style={{ color: '#5A5A5A' }}>
                    标题
                  </label>
                  <input
                    type="text"
                    value={reqTitle}
                    onChange={(e) => setReqTitle(e.target.value)}
                    placeholder="例如：需要当地交通信息"
                    className="w-full px-4 py-3 border rounded-lg text-body focus:outline-none focus:ring-2"
                    style={{ borderColor: '#E8D5D5', background: '#FFFFFF', color: '#2C2C2C' }}
                  />
                </div>
                <div>
                  <label className="block text-caption font-medium mb-2" style={{ color: '#5A5A5A' }}>
                    详细描述
                  </label>
                  <textarea
                    value={reqDescription}
                    onChange={(e) => setReqDescription(e.target.value)}
                    placeholder="请详细描述您需要的帮助..."
                    rows={5}
                    className="w-full px-4 py-3 border rounded-lg text-body focus:outline-none focus:ring-2 resize-none"
                    style={{ borderColor: '#E8D5D5', background: '#FFFFFF', color: '#2C2C2C' }}
                  />
                </div>
                <div>
                  <label className="block text-caption font-medium mb-2" style={{ color: '#5A5A5A' }}>
                    地点
                  </label>
                  <input
                    type="text"
                    value={reqLocation}
                    onChange={(e) => setReqLocation(e.target.value)}
                    placeholder="例如：北京，加拿大"
                    className="w-full px-4 py-3 border rounded-lg text-body focus:outline-none focus:ring-2"
                    style={{ borderColor: '#E8D5D5', background: '#FFFFFF', color: '#2C2C2C' }}
                  />
                </div>
                <div>
                  <label className="block text-caption font-medium mb-2" style={{ color: '#5A5A5A' }}>
                    帮助类型
                  </label>
                  <select
                    value={reqHelpType}
                    onChange={(e) => setReqHelpType(Number(e.target.value))}
                    className="w-full px-4 py-3 border rounded-lg text-body focus:outline-none focus:ring-2"
                    style={{ borderColor: '#E8D5D5', background: '#FFFFFF', color: '#2C2C2C' }}
                  >
                    {helpTypes.map((type, idx) => (
                      <option key={idx} value={idx}>
                        {type} (消耗 {waveCosts[idx]} Wave)
                      </option>
                    ))}
                  </select>
                  {user && (
                    <p className="text-caption mt-2" style={{ color: '#8A8A8A' }}>
                      当前Wave余额: <span style={{ color: user.wave >= waveCosts[reqHelpType] ? '#C4715E' : '#A05A48', fontWeight: 'bold' }}>
                        {user.wave}
                      </span> / 需要 {waveCosts[reqHelpType]} Wave
                    </p>
                  )}
        </div>
                <button
                  onClick={createRequest}
                  disabled={loading}
                  className="w-full btn-primary disabled:opacity-50"
                >
                  {loading ? '发布中...' : '发布请求'}
                </button>
              </div>
            </div>
          </div>
        ) : currentView === 'profile' ? (
          // 个人中心
          account ? (() => {
            const profileRequests = getRequestsForProfile(account);
            const userWave = getUserWave(account);
            
            // 渲染请求卡片的辅助函数
            const renderRequestCard = (req: Request) => {
              const status = req.statusNew || (req.status === 0 ? 'OPEN' : req.status === 1 ? 'IN_PROGRESS' : 'COMPLETED');
              const isRequester = req.requester.toLowerCase() === account.toLowerCase();
              
              return (
                <div key={req.id} className="card relative">
                  
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="text-h3" style={{ color: '#2C2C2C' }}>{req.title}</h4>
                    <span className="px-2 py-1 rounded-full text-sm font-medium" style={{ background: '#E8D5D5', color: '#A05A48' }}>
                      {helpTypes[req.helpType]}
                    </span>
                  </div>
                  <p className="text-body mb-3" style={{ color: '#5A5A5A' }}>{req.description}</p>
                  <div className="flex items-center text-caption mb-3" style={{ color: '#8A8A8A' }}>
                    <span>📍 {req.location}</span>
                  </div>
                  
                  {/* 状态标签 */}
                  <div className="mb-3">
                    {status === 'OPEN' && (
                      <span className="px-2 py-1 rounded text-xs" style={{ background: '#E8D5D5', color: '#A05A48' }}>开放中</span>
                    )}
                    {status === 'IN_PROGRESS' && (
                      <span className="px-2 py-1 rounded text-xs" style={{ background: '#FFF4E6', color: '#C4715E' }}>进行中</span>
                    )}
                    {status === 'COMPLETED' && (
                      <span className="px-2 py-1 rounded text-xs" style={{ background: '#E8F5E9', color: '#4CAF50' }}>已结束</span>
                    )}
                  </div>
                  
                  {/* 按钮 */}
                  {status === 'OPEN' && isRequester && (
                    <button disabled className="btn-secondary w-full opacity-60">等待帮助</button>
                  )}
                  {status === 'IN_PROGRESS' && (
                    <div className="space-y-2">
                      <button disabled className="btn-secondary w-full opacity-60">进行中</button>
                      {isRequester && (
                        <button
                          onClick={() => confirmHelpCompleted(req.id, req.requester)}
                          className="btn-primary w-full"
                        >
                          已被成功帮助
                        </button>
                      )}
                    </div>
                  )}
                  {status === 'COMPLETED' && (
                    <button disabled className="btn-secondary w-full opacity-60">已结束</button>
                  )}
                </div>
              );
            };
            
            return (
              <div className="max-w-4xl mx-auto">
                <h2 className="text-h1 mb-6" style={{ color: '#2C2C2C' }}>个人中心</h2>
                
                {/* 用户信息卡片 */}
                <div className="card p-8 mb-6">
                  <div className="text-center mb-6">
                    <div className="w-24 h-24 rounded-full mx-auto mb-4 flex items-center justify-center text-4xl font-medium text-white" style={{ background: '#C4715E' }}>
                      {user?.name ? user.name.charAt(0).toUpperCase() : account?.charAt(2).toUpperCase() || '?'}
                    </div>
                    <h3 className="text-h2" style={{ color: '#2C2C2C' }}>
                      {user?.name || '旅行者'}
                    </h3>
                    {user?.location && (
                      <p className="text-body mt-2" style={{ color: '#5A5A5A' }}>📍 {user.location}</p>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 mb-6">
                    <div className="text-center p-4 rounded-lg" style={{ background: '#E8D5D5' }}>
                      <div className="text-2xl font-bold" style={{ color: '#C4715E' }}>
                        {userWave}
                      </div>
                      <div className="text-caption mt-1" style={{ color: '#5A5A5A' }}>Wave</div>
                    </div>
                    <div className="text-center p-4 rounded-lg" style={{ background: '#E8D5D5' }}>
                      <div className="text-2xl font-bold" style={{ color: '#C4715E' }}>
                        {user?.trustScore || 50}
                      </div>
                      <div className="text-caption mt-1" style={{ color: '#5A5A5A' }}>信任评分</div>
                    </div>
                  </div>

                </div>
                
                {/* 所有活动卡片 - 合并显示 */}
                <div className="mb-6">
                  <h3 className="text-h2 mb-4" style={{ color: '#2C2C2C' }}>我的活动</h3>
                  {(() => {
                    // 合并所有请求：我发起的 + 我帮助中的 + 我帮助完成的（全部显示为完整卡片）
                    const allRequests = [
                      ...profileRequests.myRequests,
                      ...profileRequests.helpingInProgress,
                      ...profileRequests.helpingCompleted
                    ];
                    
                    if (allRequests.length === 0) {
                      return (
                        <p className="text-body text-center py-8" style={{ color: '#8A8A8A' }}>暂无活动</p>
                      );
                    }
                    
                    return (
                      <div className="flex flex-wrap gap-4 items-start">
                        {allRequests.map(renderRequestCard)}
                      </div>
                    );
                  })()}
                </div>
              </div>
            );
          })() : (
            <div className="max-w-2xl mx-auto">
              <div className="card p-8 text-center">
                <p className="text-body" style={{ color: '#5A5A5A' }}>请先连接钱包查看个人中心</p>
              </div>
            </div>
          )
        ) : null}
      </main>

      {/* 音乐控制按钮 - 右下角固定位置 */}
      {account && (
        <button
          onClick={toggleMusic}
          className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all duration-300 hover:scale-110"
          style={{
            background: isPlaying ? '#C4715E' : '#E8D5D5',
            color: isPlaying ? '#FFFFFF' : '#A05A48',
            border: '2px solid rgba(196, 113, 94, 0.3)'
          }}
          aria-label={isPlaying ? '暂停音乐' : '播放音乐'}
        >
          {isPlaying ? (
            // 暂停图标
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
          ) : (
            // 播放图标
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>
      )}

      {/* 隐藏的音频元素（用于全站播放） */}
      {account && (
        <audio
          ref={(el) => {
            if (el) {
              audioRef.current = el;
              el.volume = 0.5; // 设置音量为 50%
            }
          }}
          src="/music/andata.mp3"
          loop
          style={{ display: 'none' }}
        />
      )}
      
      {/* Toast 提示 */}
      {toastMessage && (
        <div
          className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50 px-6 py-3 rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2"
          style={{
            background: '#C4715E',
            color: '#FFFFFF',
            minWidth: '200px',
            textAlign: 'center',
            fontSize: '14px',
            fontWeight: '500'
          }}
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}
