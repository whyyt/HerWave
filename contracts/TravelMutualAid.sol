// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract TravelMutualAid {
    // 用户信息结构
    struct User {
        string name;
        string location;
        uint256 trustScore; // 信任评分 (0-100)
        uint256 totalHelps; // 帮助次数
        uint256 totalReceived; // 接受帮助次数
        uint256 credits; // Credits余额
        bool exists;
    }

    // 互助请求结构
    struct Request {
        uint256 id;
        address requester;
        string title;
        string description;
        string location;
        uint256 timestamp;
        RequestStatus status;
        address helper; // 提供帮助的人
        uint256 helpType; // 0: 机场/车站接送, 1: 一日游导览, 2: 沙发客住宿
    }
    
    // Credits消耗和获得配置
    // helpType -> 消耗Credits
    mapping(uint256 => uint256) public creditCosts;
    uint256 public constant CREDIT_REWARD = 1; // 接受任务获得的Credits

    enum RequestStatus {
        Open,
        Matched,
        Completed,
        Cancelled
    }

    // 评价结构
    struct Review {
        address reviewer;
        address reviewed;
        uint256 requestId;
        uint256 rating; // 1-5
        string comment;
        uint256 timestamp;
    }

    // 状态变量
    mapping(address => User) public users;
    mapping(uint256 => Request) public requests;
    mapping(uint256 => Review[]) public requestReviews;
    mapping(address => Review[]) public userReviews;
    
    uint256 public requestCount;
    address[] public userAddresses;

    // 构造函数：初始化Credits配置
    constructor() {
        // 机场/车站接送: 消耗2 Credits
        creditCosts[0] = 2;
        // 一日游导览: 消耗5 Credits
        creditCosts[1] = 5;
        // 沙发客住宿: 消耗3 Credits
        creditCosts[2] = 3;
    }

    // 事件
    event UserRegistered(address indexed user, string name);
    event RequestCreated(uint256 indexed requestId, address indexed requester, string title);
    event RequestMatched(uint256 indexed requestId, address indexed helper);
    event RequestCompleted(uint256 indexed requestId);
    event ReviewSubmitted(uint256 indexed requestId, address indexed reviewer, address indexed reviewed, uint256 rating);

    // 注册用户
    function registerUser(string memory _name, string memory _location) public {
        require(!users[msg.sender].exists, "User already registered");
        
        users[msg.sender] = User({
            name: _name,
            location: _location,
            trustScore: 50, // 初始信任分
            totalHelps: 0,
            totalReceived: 0,
            credits: 10, // 新用户初始Credits
            exists: true
        });
        
        userAddresses.push(msg.sender);
        emit UserRegistered(msg.sender, _name);
    }

    // 创建互助请求
    function createRequest(
        string memory _title,
        string memory _description,
        string memory _location,
        uint256 _helpType
    ) public {
        // 如果用户未注册，自动注册
        if (!users[msg.sender].exists) {
            users[msg.sender] = User({
                name: "",
                location: _location,
                trustScore: 50,
                totalHelps: 0,
                totalReceived: 0,
                credits: 10, // 新用户初始Credits
                exists: true
            });
            userAddresses.push(msg.sender);
        }
        
        // 检查并扣除Credits
        uint256 cost = creditCosts[_helpType];
        require(cost > 0, "Invalid help type");
        require(users[msg.sender].credits >= cost, "Insufficient credits");
        
        users[msg.sender].credits -= cost;
        
        requestCount++;
        requests[requestCount] = Request({
            id: requestCount,
            requester: msg.sender,
            title: _title,
            description: _description,
            location: _location,
            timestamp: block.timestamp,
            status: RequestStatus.Open,
            helper: address(0),
            helpType: _helpType
        });
        
        users[msg.sender].totalReceived++;
        emit RequestCreated(requestCount, msg.sender, _title);
    }

    // 接受请求（提供帮助）
    function acceptRequest(uint256 _requestId) public {
        // 如果用户未注册，自动注册
        if (!users[msg.sender].exists) {
            users[msg.sender] = User({
                name: "",
                location: "",
                trustScore: 50,
                totalHelps: 0,
                totalReceived: 0,
                credits: 10, // 新用户初始Credits
                exists: true
            });
            userAddresses.push(msg.sender);
        }
        
        Request storage request = requests[_requestId];
        require(request.status == RequestStatus.Open, "Request not available");
        require(request.requester != msg.sender, "Cannot help yourself");
        
        request.helper = msg.sender;
        request.status = RequestStatus.Matched;
        users[msg.sender].totalHelps++;
        
        // 接受任务后立即获得Credits奖励
        users[msg.sender].credits += CREDIT_REWARD;
        
        emit RequestMatched(_requestId, msg.sender);
    }

    // 完成请求
    function completeRequest(uint256 _requestId) public {
        Request storage request = requests[_requestId];
        require(
            msg.sender == request.requester || msg.sender == request.helper,
            "Not authorized"
        );
        require(request.status == RequestStatus.Matched, "Request not matched");
        
        request.status = RequestStatus.Completed;
        emit RequestCompleted(_requestId);
    }

    // 提交评价
    function submitReview(
        uint256 _requestId,
        address _reviewed,
        uint256 _rating,
        string memory _comment
    ) public {
        require(_rating >= 1 && _rating <= 5, "Rating must be 1-5");
        Request storage request = requests[_requestId];
        require(
            (msg.sender == request.requester && _reviewed == request.helper) ||
            (msg.sender == request.helper && _reviewed == request.requester),
            "Invalid review"
        );
        require(request.status == RequestStatus.Completed, "Request not completed");
        
        Review memory review = Review({
            reviewer: msg.sender,
            reviewed: _reviewed,
            requestId: _requestId,
            rating: _rating,
            comment: _comment,
            timestamp: block.timestamp
        });
        
        requestReviews[_requestId].push(review);
        userReviews[_reviewed].push(review);
        
        // 更新信任评分
        _updateTrustScore(_reviewed);
        
        emit ReviewSubmitted(_requestId, msg.sender, _reviewed, _rating);
    }

    // 更新信任评分
    function _updateTrustScore(address _user) internal {
        Review[] memory reviews = userReviews[_user];
        if (reviews.length == 0) return;
        
        uint256 totalRating = 0;
        for (uint256 i = 0; i < reviews.length; i++) {
            totalRating += reviews[i].rating;
        }
        
        // 信任评分 = 平均评分 * 20 (1-5分映射到20-100分)
        uint256 avgRating = totalRating * 20 / reviews.length;
        users[_user].trustScore = avgRating;
    }

    // 获取用户信息
    function getUser(address _user) public view returns (User memory) {
        return users[_user];
    }
    
    // 获取用户的Credits余额
    function getUserCredits(address _user) public view returns (uint256) {
        return users[_user].credits;
    }
    
    // 获取帮助类型的Credits消耗
    function getCreditCost(uint256 _helpType) public view returns (uint256) {
        return creditCosts[_helpType];
    }

    // 获取请求信息
    function getRequest(uint256 _requestId) public view returns (Request memory) {
        return requests[_requestId];
    }

    // 获取所有开放请求
    function getOpenRequests() public view returns (Request[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i <= requestCount; i++) {
            if (requests[i].status == RequestStatus.Open) {
                count++;
            }
        }
        
        Request[] memory openRequests = new Request[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= requestCount; i++) {
            if (requests[i].status == RequestStatus.Open) {
                openRequests[index] = requests[i];
                index++;
            }
        }
        return openRequests;
    }

    // 获取用户的请求
    function getUserRequests(address _user) public view returns (Request[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i <= requestCount; i++) {
            if (requests[i].requester == _user || requests[i].helper == _user) {
                count++;
            }
        }
        
        Request[] memory userRequests = new Request[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= requestCount; i++) {
            if (requests[i].requester == _user || requests[i].helper == _user) {
                userRequests[index] = requests[i];
                index++;
            }
        }
        return userRequests;
    }
}

