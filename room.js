// 전역 변수
let peer;
let myPeerId;
let localStream;
let screenStream;
let connections = {};
let dataConnections = {};
let chatHistory = [];
let isVideoEnabled = true;
let isAudioEnabled = true;
let myName = '';
let myRole = '';
let roomId = '';

// URL 파라미터 파싱
const urlParams = new URLSearchParams(window.location.search);
roomId = urlParams.get('room');
myRole = urlParams.get('role');
myName = urlParams.get('name') || (myRole === 'teacher' ? '교사' : '학생');

// 페이지 로드 시 초기화
window.addEventListener('load', async () => {
    try {
        // 미디어 스트림 가져오기
        await getLocalStream();
        
        // PeerJS 초기화
        initializePeer();
    } catch (error) {
        console.error('초기화 오류:', error);
        alert('카메라와 마이크 접근 권한이 필요합니다.\n\n설정에서 권한을 허용해주세요.');
    }
});

// 로컬 미디어 스트림 가져오기
async function getLocalStream() {
    try {
        // 먼저 권한 요청
        const constraints = {
            video: {
                width: { ideal: 1280, max: 1920 },
                height: { ideal: 720, max: 1080 },
                facingMode: 'user'
            },
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        };

        localStream = await navigator.mediaDevices.getUserMedia(constraints);

        // 내 비디오 추가
        addVideoStream('local', localStream, '나 (' + myName + ')');
        
        console.log('미디어 스트림 획득 성공');
        return localStream;
    } catch (error) {
        console.error('미디어 스트림 오류:', error);
        
        let errorMessage = '카메라와 마이크 접근 권한이 필요합니다.\n\n';
        
        if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
            errorMessage += '브라우저 설정에서 카메라와 마이크 권한을 허용해주세요.\n\n';
            errorMessage += '크롬: 주소창 왼쪽 자물쇠 아이콘 클릭 → 권한 설정\n';
            errorMessage += '사파리: 설정 → Safari → 카메라/마이크 접근 허용';
        } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
            errorMessage += '카메라 또는 마이크가 연결되어 있지 않습니다.\n';
            errorMessage += '장치를 연결한 후 다시 시도해주세요.';
        } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
            errorMessage += '카메라 또는 마이크가 다른 앱에서 사용 중일 수 있습니다.\n';
            errorMessage += '다른 앱을 종료한 후 다시 시도해주세요.';
        } else {
            errorMessage += '알 수 없는 오류가 발생했습니다.\n';
            errorMessage += '페이지를 새로고침하거나 다른 브라우저를 사용해보세요.';
        }
        
        alert(errorMessage);
        throw error;
    }
}

// PeerJS 초기화
function initializePeer() {
    // PeerJS 연결 (공식 무료 PeerServer 사용)
    peer = new Peer(undefined, {
        host: '0.peerjs.com',
        port: 443,
        path: '/',
        secure: true,
        debug: 2,
        config: {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' },
                { urls: 'stun:stun2.l.google.com:19302' }
            ]
        }
    });

    peer.on('open', (id) => {
        myPeerId = id;
        console.log('내 Peer ID:', myPeerId);
        
        // 룸에 참여 정보 저장
        saveRoomParticipant();
        
        // 다른 참여자들 확인
        checkExistingParticipants();
        
        // 로딩 제거
        document.getElementById('loading').style.display = 'none';
    });

    peer.on('call', (call) => {
        console.log('수신된 통화:', call.peer);
        
        // 통화 수락
        call.answer(localStream);
        
        call.on('stream', (remoteStream) => {
            console.log('원격 스트림 수신:', call.peer);
            addVideoStream(call.peer, remoteStream, '참여자');
        });

        call.on('close', () => {
            removeVideoStream(call.peer);
        });

        connections[call.peer] = call;
    });

    peer.on('connection', (conn) => {
        setupDataConnection(conn);
    });

    peer.on('error', (error) => {
        console.error('Peer 오류:', error);
        
        if (error.type === 'unavailable-id') {
            // ID가 이미 사용중일 경우 재시도
            peer.destroy();
            setTimeout(initializePeer, 1000);
        }
    });
}

// 룸 참여 정보 저장
function saveRoomParticipant() {
    const participants = JSON.parse(localStorage.getItem(roomId + '_participants') || '[]');
    
    const myInfo = {
        peerId: myPeerId,
        name: myName,
        role: myRole,
        joinedAt: new Date().toISOString()
    };
    
    // 중복 제거
    const filtered = participants.filter(p => p.peerId !== myPeerId);
    filtered.push(myInfo);
    
    localStorage.setItem(roomId + '_participants', JSON.stringify(filtered));
}

// 기존 참여자 확인 및 연결
function checkExistingParticipants() {
    const participants = JSON.parse(localStorage.getItem(roomId + '_participants') || '[]');
    
    participants.forEach(participant => {
        if (participant.peerId !== myPeerId) {
            connectToPeer(participant.peerId, participant.name);
        }
    });
}

// 피어에 연결
function connectToPeer(peerId, peerName) {
    if (connections[peerId]) return;
    
    console.log('피어에 연결:', peerId);
    
    // 비디오 통화
    const call = peer.call(peerId, localStream);
    
    call.on('stream', (remoteStream) => {
        console.log('원격 스트림 수신:', peerId);
        addVideoStream(peerId, remoteStream, peerName || '참여자');
    });

    call.on('close', () => {
        removeVideoStream(peerId);
    });

    connections[peerId] = call;
    
    // 데이터 연결
    const conn = peer.connect(peerId);
    setupDataConnection(conn);
}

// 데이터 연결 설정
function setupDataConnection(conn) {
    conn.on('open', () => {
        console.log('데이터 연결 열림:', conn.peer);
        dataConnections[conn.peer] = conn;
        
        // 환영 메시지
        conn.send({
            type: 'join',
            name: myName,
            peerId: myPeerId,
            timestamp: new Date().toISOString()
        });
    });

    conn.on('data', (data) => {
        handleIncomingData(data, conn.peer);
    });

    conn.on('close', () => {
        delete dataConnections[conn.peer];
    });

    dataConnections[conn.peer] = conn;
}

// 수신 데이터 처리
function handleIncomingData(data, fromPeer) {
    console.log('데이터 수신:', data);
    
    switch (data.type) {
        case 'chat':
            displayChatMessage(data.message, data.sender, false);
            break;
        case 'file':
            displayFileMessage(data.fileName, data.fileData, data.sender);
            break;
        case 'join':
            addSystemMessage(`${data.name}님이 입장했습니다.`);
            break;
    }
}

// 비디오 스트림 추가
function addVideoStream(id, stream, label) {
    // 이미 있는지 확인
    if (document.getElementById('video-' + id)) {
        return;
    }
    
    const videosGrid = document.getElementById('videosGrid');
    
    const wrapper = document.createElement('div');
    wrapper.className = 'video-wrapper';
    wrapper.id = 'video-' + id;
    
    const video = document.createElement('video');
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    
    // 자신의 비디오는 음소거
    if (id === 'local') {
        video.muted = true;
    }
    
    const labelDiv = document.createElement('div');
    labelDiv.className = 'video-label';
    labelDiv.textContent = label;
    
    const controlsDiv = document.createElement('div');
    controlsDiv.className = 'video-controls';
    
    const pipBtn = document.createElement('button');
    pipBtn.className = 'video-control-btn';
    pipBtn.textContent = 'PIP';
    pipBtn.onclick = () => requestPiP(video);
    
    const fullscreenBtn = document.createElement('button');
    fullscreenBtn.className = 'video-control-btn';
    fullscreenBtn.textContent = '전체';
    fullscreenBtn.onclick = () => toggleFullscreen(wrapper);
    
    controlsDiv.appendChild(pipBtn);
    controlsDiv.appendChild(fullscreenBtn);
    
    wrapper.appendChild(video);
    wrapper.appendChild(labelDiv);
    wrapper.appendChild(controlsDiv);
    
    videosGrid.appendChild(wrapper);
}

// 비디오 스트림 제거
function removeVideoStream(id) {
    const videoElement = document.getElementById('video-' + id);
    if (videoElement) {
        videoElement.remove();
    }
}

// PIP (Picture-in-Picture) 요청
async function requestPiP(video) {
    try {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
        } else {
            await video.requestPictureInPicture();
        }
    } catch (error) {
        console.error('PIP 오류:', error);
        alert('PIP 모드를 사용할 수 없습니다.');
    }
}

// 전체화면 토글
function toggleFullscreen(wrapper) {
    const videosGrid = document.getElementById('videosGrid');
    
    if (wrapper.classList.contains('fullscreen-active')) {
        wrapper.classList.remove('fullscreen-active');
        videosGrid.classList.remove('fullscreen-mode');
    } else {
        // 모든 전체화면 제거
        document.querySelectorAll('.fullscreen-active').forEach(el => {
            el.classList.remove('fullscreen-active');
        });
        videosGrid.classList.remove('fullscreen-mode');
        
        // 새로운 전체화면 설정
        wrapper.classList.add('fullscreen-active');
        videosGrid.classList.add('fullscreen-mode');
    }
}

// 비디오 토글
function toggleVideo() {
    isVideoEnabled = !isVideoEnabled;
    
    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = isVideoEnabled;
    }
    
    const btn = document.getElementById('toggleVideo');
    btn.classList.toggle('active', isVideoEnabled);
    btn.classList.toggle('inactive', !isVideoEnabled);
    btn.textContent = isVideoEnabled ? '📹 비디오' : '📹 비디오 (꺼짐)';
}

// 오디오 토글
function toggleAudio() {
    isAudioEnabled = !isAudioEnabled;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = isAudioEnabled;
    }
    
    const btn = document.getElementById('toggleAudio');
    btn.classList.toggle('active', isAudioEnabled);
    btn.classList.toggle('inactive', !isAudioEnabled);
    btn.textContent = isAudioEnabled ? '🎤 오디오' : '🎤 오디오 (꺼짐)';
}

// 화면 공유
async function shareScreen() {
    try {
        if (screenStream) {
            // 화면 공유 중지
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
            
            // 원래 비디오로 복귀
            replaceStream(localStream);
            
            document.getElementById('shareScreen').textContent = '🖥️ 화면공유';
            return;
        }
        
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always'
            },
            audio: false
        });
        
        // 화면 공유 스트림으로 교체
        replaceStream(screenStream);
        
        document.getElementById('shareScreen').textContent = '🖥️ 공유중지';
        
        // 화면 공유가 중지되면
        screenStream.getVideoTracks()[0].onended = () => {
            screenStream = null;
            replaceStream(localStream);
            document.getElementById('shareScreen').textContent = '🖥️ 화면공유';
        };
        
    } catch (error) {
        console.error('화면 공유 오류:', error);
        alert('화면 공유를 시작할 수 없습니다.');
    }
}

// 스트림 교체
function replaceStream(newStream) {
    const videoTrack = newStream.getVideoTracks()[0];
    
    // 모든 연결된 피어에게 새 스트림 전송
    Object.values(connections).forEach(call => {
        const sender = call.peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender) {
            sender.replaceTrack(videoTrack);
        }
    });
    
    // 내 비디오 업데이트
    const myVideo = document.querySelector('#video-local video');
    if (myVideo) {
        myVideo.srcObject = newStream;
    }
}

// 채팅 토글
function toggleChat() {
    const chatContainer = document.getElementById('chatContainer');
    chatContainer.classList.toggle('chat-hidden');
    
    // 모바일에서는 다르게 처리
    if (window.innerWidth <= 768) {
        chatContainer.classList.toggle('mobile-visible');
    }
}

// 채팅 메시지 전송
function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    // 모든 피어에게 전송
    Object.values(dataConnections).forEach(conn => {
        conn.send({
            type: 'chat',
            message: message,
            sender: myName,
            timestamp: new Date().toISOString()
        });
    });
    
    // 내 화면에 표시
    displayChatMessage(message, myName, true);
    
    input.value = '';
}

// 채팅 메시지 표시
function displayChatMessage(message, sender, isOwn) {
    const messagesDiv = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (isOwn ? 'own' : 'other');
    
    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender';
    senderDiv.textContent = sender;
    
    const textDiv = document.createElement('div');
    textDiv.className = 'message-text';
    textDiv.textContent = message;
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString('ko-KR');
    
    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(textDiv);
    messageDiv.appendChild(timeDiv);
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
    
    // 채팅 기록 저장
    chatHistory.push({
        sender: sender,
        message: message,
        timestamp: new Date().toISOString()
    });
}

// 시스템 메시지
function addSystemMessage(message) {
    const messagesDiv = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.style.textAlign = 'center';
    messageDiv.style.color = '#95a5a6';
    messageDiv.style.fontSize = '0.85em';
    messageDiv.style.padding = '10px';
    messageDiv.textContent = message;
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 엔터키로 메시지 전송
function handleChatKeyPress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

// 파일 전송
async function sendFile() {
    const fileInput = document.getElementById('fileInput');
    const file = fileInput.files[0];
    
    if (!file) return;
    
    // 파일 크기 제한 (10MB)
    if (file.size > 10 * 1024 * 1024) {
        alert('파일 크기는 10MB 이하여야 합니다.');
        return;
    }
    
    const reader = new FileReader();
    
    reader.onload = (e) => {
        const fileData = e.target.result;
        
        // 모든 피어에게 전송
        Object.values(dataConnections).forEach(conn => {
            conn.send({
                type: 'file',
                fileName: file.name,
                fileData: fileData,
                sender: myName,
                timestamp: new Date().toISOString()
            });
        });
        
        // 내 화면에 표시
        displayFileMessage(file.name, fileData, myName);
    };
    
    reader.readAsDataURL(file);
    fileInput.value = '';
}

// 파일 메시지 표시
function displayFileMessage(fileName, fileData, sender) {
    const messagesDiv = document.getElementById('chatMessages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message ' + (sender === myName ? 'own' : 'other');
    
    const senderDiv = document.createElement('div');
    senderDiv.className = 'message-sender';
    senderDiv.textContent = sender;
    
    const fileDiv = document.createElement('div');
    fileDiv.className = 'file-message';
    
    const link = document.createElement('a');
    link.href = fileData;
    link.download = fileName;
    link.className = 'file-link';
    link.innerHTML = `📎 ${fileName}`;
    
    fileDiv.appendChild(link);
    
    const timeDiv = document.createElement('div');
    timeDiv.className = 'message-time';
    timeDiv.textContent = new Date().toLocaleTimeString('ko-KR');
    
    messageDiv.appendChild(senderDiv);
    messageDiv.appendChild(fileDiv);
    messageDiv.appendChild(timeDiv);
    
    messagesDiv.appendChild(messageDiv);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// 채팅 CSV 저장
function saveChatsToCSV() {
    if (chatHistory.length === 0) {
        alert('저장할 채팅 내역이 없습니다.');
        return;
    }
    
    let csv = 'Timestamp,Sender,Message\n';
    
    chatHistory.forEach(chat => {
        const timestamp = new Date(chat.timestamp).toLocaleString('ko-KR');
        const sender = chat.sender.replace(/,/g, '');
        const message = chat.message.replace(/,/g, '');
        
        csv += `"${timestamp}","${sender}","${message}"\n`;
    });
    
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `ezlive_chat_${roomId}_${Date.now()}.csv`;
    link.click();
}

// 판서도구 열기
function openWhiteboard() {
    window.open('whiteboard.html?room=' + roomId, 'whiteboard', 'width=1200,height=800');
}

// 방 나가기
function leaveRoom() {
    if (confirm('강의실을 나가시겠습니까?')) {
        // 모든 연결 종료
        Object.values(connections).forEach(call => call.close());
        Object.values(dataConnections).forEach(conn => conn.close());
        
        // 스트림 중지
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
        }
        
        // Peer 연결 종료
        if (peer) {
            peer.destroy();
        }
        
        // 참여자 목록에서 제거
        const participants = JSON.parse(localStorage.getItem(roomId + '_participants') || '[]');
        const filtered = participants.filter(p => p.peerId !== myPeerId);
        localStorage.setItem(roomId + '_participants', JSON.stringify(filtered));
        
        // 메인 페이지로 이동
        window.location.href = 'index.html';
    }
}

// 페이지 벗어날 때 정리
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
    }
});
