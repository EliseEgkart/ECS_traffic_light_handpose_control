// ----------------------------------------------------
// 전역 변수들
// ----------------------------------------------------

// 아두이노에서 수신하는 시리얼 통신 관련
let port;                         // 시리얼 포트 객체를 저장하는 변수
let portConnected = false;        // 포트 연결 상태를 나타내는 불리언 변수
let latestData = "";              // 수신한 문자열 데이터를 누적 저장

// 아두이노에서 수신한 데이터 (LED 밝기, 모드, LED 상태)
let brightnessValue = "";         // LED 밝기 값을 저장
let modeValue = "";               // 현재 모드를 저장
let ledState = [0, 0, 0];          // 각 LED의 상태를 0(꺼짐) 또는 1(켜짐)로 저장

// UI 요소 (버튼, 슬라이더 등)
let connectButton;                // 시리얼 연결을 위한 버튼
let rSlider, ySlider, gSlider;    // 각각 빨강, 노랑, 초록 LED 조절 슬라이더
let lastSentTime = 0;             // 마지막으로 데이터를 전송한 시간
let sendInterval = 500;           // 데이터 전송 간격 (밀리초 단위)

// ml5 HandPose 관련
let handPose;                     // ml5.js HandPose 모델 객체
let video;                        // 웹캠 영상 객체
let hands = [];                   // 감지된 손 정보를 저장하는 배열

// 팔레트 모드 관련
let paletteActive = false;        // 팔레트 모드 활성화 상태

// 신호 주기(슬라이더 매핑) 관련
let signalPeriod = 1000;          // 기본 신호 주기 (밀리초)
let paletteTimer = 0;             // 팔레트 모드에서 안정화 시간 측정 타이머
let paletteLastPeriod = null;     // 이전에 측정된 슬라이더 매핑 값

// 화면에 표시할 제스처 메시지
let gestureMessage = "";          // 현재 감지된 제스처를 텍스트로 저장

// 스켈레톤 연결 정보
const fingerConnections = [       // 손의 관절들을 연결하는 인덱스 배열 (스켈레톤 그리기에 사용)
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20]
];

// 제스처 인식 및 모드 전환 관련 변수들
let pendingModeToken = "";        // 다음 모드 전환을 위해 보류 중인 토큰 값
let lastGesture = "";             // 마지막으로 감지된 제스처 기록
let gestureTimer = 0;             // 동일 제스처 유지 시간을 누적하는 타이머
let confirmedGesture = "";        // 최종 확정된 제스처
const gestureThreshold = 1000;    // 제스처 유지 확인을 위한 최소 시간 (1초)

// ----------------------------------------------------
// 1. 시리얼 통신 관련
//    (connectSerial, readLoop, processSerialData, sendSliderValues)
// ----------------------------------------------------

/**
 * @brief 브라우저 시리얼 API를 통해 포트를 요청하고 연결 후, readLoop()를 시작한다.
 */
async function connectSerial() {
  try {
    port = await navigator.serial.requestPort(); // 사용자가 시리얼 포트를 선택하도록 요청
    await port.open({ baudRate: 9600 });           // 선택된 포트를 9600 보드레이트로 염
    portConnected = true;                          // 연결 성공 상태로 업데이트
    connectButton.html("Serial Connected");        // UI 버튼 텍스트를 변경하여 연결 상태 표시
    readLoop();                                    // 데이터를 지속적으로 읽기 위한 루프 시작
  } catch (error) {
    console.log("Serial connection error: " + error); // 오류 발생 시 콘솔에 메시지 출력
  }
}

/**
 * @brief 시리얼 포트에서 데이터를 지속적으로 읽어와 processSerialData()에 전달한다.
 */
async function readLoop() {
  const decoder = new TextDecoder();  // 수신한 바이트 데이터를 문자열로 변환할 디코더 생성
  while (port.readable) {             // 포트가 읽기 가능한 동안 반복
    const reader = port.readable.getReader(); // 포트에서 데이터를 읽기 위한 리더 생성
    try {
      while (true) {
        const { value, done } = await reader.read(); // 리더로부터 데이터를 읽어옴
        if (done) break;                              // 읽기 완료 시 반복 종료
        if (value) {
          latestData += decoder.decode(value);        // 수신 데이터를 문자열로 디코딩 후 누적
          if (latestData.indexOf("\n") !== -1) {        // 개행 문자가 있는지 확인
            let lines = latestData.split("\n");         // 개행 기준으로 데이터를 분할
            let completeLine = lines[0].trim();         // 첫 번째 완성된 줄 추출 및 공백 제거
            processSerialData(completeLine);            // 완성된 데이터를 파싱 함수에 전달
            latestData = lines.slice(1).join("\n");       // 남은 데이터를 다시 latestData에 저장
          }
        }
      }
    } catch (error) {
      console.log("Read error:", error); // 읽기 중 예외 발생 시 로그 출력
    } finally {
      reader.releaseLock();              // 리더의 lock을 해제하여 다른 작업이 가능하도록 함
    }
  }
}

/**
 * @brief 아두이노 -> PC 데이터 파싱 함수. LED 상태 및 모드를 갱신한다.
 * @param {string} dataStr 수신된 문자열
 */
function processSerialData(dataStr) {
  // 예: "B: 160 M: PCINT2 O: 1,0,1"
  const pattern = /^B:\s*(\d+)\s*M:\s*(\S+)\s*O:\s*([\d,]+)/; // 정규 표현식으로 데이터 포맷 정의
  const match = dataStr.match(pattern);                          // 수신 데이터와 패턴 매칭 시도

  if (match) {
    let newBrightness = match[1];   // 추출된 LED 밝기 값
    let newMode = match[2];         // 추출된 모드 값
    let ledStates = match[3];       // 추출된 LED 상태 문자열

    if (!isNaN(newBrightness) && newBrightness !== "") {
      brightnessValue = newBrightness; // 유효한 밝기 값이면 업데이트
    }
    modeValue = newMode;               // 모드 값을 업데이트

    let states = ledStates.split(","); // LED 상태를 쉼표 기준으로 분리
    if (states.length === 3) {
      ledState[0] = parseInt(states[0]); // 각 LED의 상태를 정수로 변환 후 저장
      ledState[1] = parseInt(states[1]);
      ledState[2] = parseInt(states[2]);
    }

    updateInfoDisplay();   // 화면에 LED 정보 업데이트
    updateIndicators();    // 각 LED 인디케이터의 색상 업데이트
  }
}

/**
 * @brief 슬라이더 값 및 모드 토큰을 시리얼 포트로 전송한다.
 */
async function sendSliderValues() {
  if (port && port.writable) {        // 포트가 연결되어 있고 쓰기가 가능한지 확인
    const encoder = new TextEncoder();  // 문자열 데이터를 바이트로 인코딩할 엔코더 생성
    let modeTokenToSend = pendingModeToken; // 대기 중인 모드 토큰을 임시 변수에 저장
    pendingModeToken = "";              // 중복 전송 방지를 위해 토큰 초기화

    let dataToSend =
      rSlider.value() + "," +         // 빨강 슬라이더 값을 문자열로 변환
      ySlider.value() + "," +         // 노랑 슬라이더 값을 문자열로 변환
      gSlider.value() + ",";          // 초록 슬라이더 값을 문자열로 변환
    if (modeTokenToSend) {
      dataToSend += modeTokenToSend;  // 모드 토큰이 존재하면 데이터에 포함
    }
    dataToSend += "\n";               // 데이터 끝에 개행 문자 추가

    // 시리얼 전송
    const writer = port.writable.getWriter();      // 포트에 데이터를 쓰기 위한 writer 생성
    await writer.write(encoder.encode(dataToSend));  // 인코딩한 데이터를 포트로 전송
    writer.releaseLock();                            // writer lock을 해제
  }
}

// ----------------------------------------------------
// 2. 디스플레이 인디케이터 업데이트
//    (updateInfoDisplay, updateIndicators)
// ----------------------------------------------------

/**
 * @brief 현재 LED 밝기, 모드 값을 화면에 표시한다.
 */
function updateInfoDisplay() {
  const infoElement = document.getElementById("serialInfo"); // HTML에서 serialInfo 요소 선택
  infoElement.textContent = `Brightness : ${brightnessValue} / Mode : ${modeValue}`; // 최신 LED 정보 텍스트 업데이트
}

/**
 * @brief ledState 배열을 기반으로 각 LED 인디케이터 색상 업데이트
 */
function updateIndicators() {
  let bVal = parseInt(brightnessValue); // 밝기 값을 정수로 변환
  if (isNaN(bVal)) bVal = 0;             // 변환 실패 시 0으로 설정
  const redIndicator = document.getElementById("red-indicator");       // 빨강 LED 인디케이터 선택
  const yellowIndicator = document.getElementById("yellow-indicator"); // 노랑 LED 인디케이터 선택
  const greenIndicator = document.getElementById("green-indicator");   // 초록 LED 인디케이터 선택

  if (ledState[0] === 1) {
    redIndicator.style.backgroundColor = `rgb(${bVal}, 0, 0)`; // LED 켜짐: 밝은 빨강 색상 적용
  } else {
    redIndicator.style.backgroundColor = `rgb(${bVal * 0.2}, 0, 0)`; // LED 꺼짐: 어두운 빨강 색상 적용
  }
  if (ledState[1] === 1) {
    yellowIndicator.style.backgroundColor = `rgb(${bVal}, ${bVal}, 0)`; // LED 켜짐: 밝은 노랑 색상 적용
  } else {
    yellowIndicator.style.backgroundColor = `rgb(${bVal * 0.2}, ${bVal * 0.2}, 0)`; // LED 꺼짐: 어두운 노랑 색상 적용
  }
  if (ledState[2] === 1) {
    greenIndicator.style.backgroundColor = `rgb(0, ${bVal}, 0)`; // LED 켜짐: 밝은 초록 색상 적용
  } else {
    greenIndicator.style.backgroundColor = `rgb(0, ${bVal * 0.2}, 0)`; // LED 꺼짐: 어두운 초록 색상 적용
  }
}

// ----------------------------------------------------
// 3. 영상, 제스처 관련
//    (preload, gotHands, detectGesture, changeMode, drawPalette,
//     그리고 setup(), draw()도 여기 포함)
// ----------------------------------------------------

/**
 * @brief ml5.js의 HandPose 모델을 미리 로드한다.
 */
function preload() {
  handPose = ml5.handPose(); // HandPose 모델 로드 시작 (비동기로 처리됨)
}

/**
 * @brief p5.js 초기화 함수. 웹캠, HandPose 설정 및 UI 요소 연결
 */
function setup() {
  let myCanvas = createCanvas(640, 480);      // 640x480 크기의 캔버스 생성
  myCanvas.parent("canvas-container");         // 생성된 캔버스를 지정된 부모 요소에 추가

  // 웹캠 및 HandPose
  video = createCapture(VIDEO, { flipped: true }); // 웹캠 영상 캡처 및 좌우 반전 설정
  video.size(640, 480);                              // 웹캠 영상의 크기 설정
  video.hide();                                    // 기본 HTML 영상 요소 숨김 처리
  handPose.detectStart(video, gotHands);           // HandPose 모델에 웹캠 영상을 전달하여 손 인식 시작

  // UI 버튼 및 슬라이더
  connectButton = select("#connectButton");        // 시리얼 연결 버튼 선택
  connectButton.mousePressed(connectSerial);         // 버튼 클릭 시 시리얼 연결 함수 호출
  rSlider = select("#rSlider");                      // 빨강 슬라이더 선택
  ySlider = select("#ySlider");                      // 노랑 슬라이더 선택
  gSlider = select("#gSlider");                      // 초록 슬라이더 선택
}

/**
 * @brief p5.js 메인 루프. 매 프레임마다 웹캠 영상, 제스처, 팔레트 모드 등을 처리한다.
 */
function draw() {
  // 슬라이더 값 및 모드 전송
  if (portConnected && millis() - lastSentTime > sendInterval) { // 일정 간격마다 데이터 전송 조건 확인
    sendSliderValues();             // 슬라이더 값과 모드 토큰 전송
    lastSentTime = millis();        // 마지막 전송 시간을 현재 시간으로 업데이트
  }

  // 웹캠 영상 표시
  image(video, 0, 0, width, height);  // 캔버스에 웹캠 영상 그리기

  // HandPose 키포인트 및 스켈레톤 그리기
  drawHandKeypointsAndSkeleton();   // 감지된 손의 키포인트와 스켈레톤을 캔버스에 그림

  // 제스처 인식 및 안정화 처리
  if (hands.length > 0) {
    let detectedGesture = detectGesture(hands[0]); // 첫 번째 감지된 손의 제스처 판별
    if (detectedGesture === lastGesture) {
      gestureTimer += deltaTime;  // 이전 제스처와 동일하면 타이머 누적
    } else {
      lastGesture = detectedGesture; // 제스처 변경 시 새로운 제스처로 업데이트
      gestureTimer = 0;             // 타이머 초기화
    }
    let avgPos = getAverageKeypointPosition(hands[0]); // 손의 평균 위치 계산
    let progress = constrain(gestureTimer / gestureThreshold, 0, 1); // 제스처 유지 비율 계산
    drawGestureGauge(progress, avgPos); // 제스처 유지 상태 게이지 시각화

    // 제스처 확정: 타이머가 임계치를 넘으면 제스처를 확정하고 모드 변경 처리
    if (gestureTimer >= gestureThreshold && detectedGesture !== confirmedGesture) {
      confirmedGesture = detectedGesture; // 확정된 제스처 업데이트
      if (paletteActive && confirmedGesture !== "Palette") {
        // 팔레트 모드 활성화 시 Palette 제스처만 동작하도록 예외 처리
      } else {
        changeMode(confirmedGesture); // 제스처에 따른 모드 변경 함수 호출
      }
    }
  } else {
    gestureTimer = 0;       // 손 인식 실패 시 타이머 리셋
    lastGesture = "";       // 마지막 제스처 초기화
    confirmedGesture = "";  // 확정 제스처 초기화
    if (!paletteActive) {
      drawGestureGauge(0, { x: width / 2, y: height - 40 }); // 손이 없을 경우 기본 위치에 게이지 그리기
    }
  }

  // 팔레트 모드가 활성화된 경우, 팔레트 UI 그리기
  if (paletteActive) {
    drawPalette(); // 팔레트 모드 UI를 캔버스에 그림
  }

  // 화면 좌측 상단에 제스처 메시지 표시
  fill(255);                        // 텍스트 색상 설정 (흰색)
  textSize(16);                     // 텍스트 크기 설정
  textAlign(LEFT, TOP);             // 텍스트 정렬 설정
  text(gestureMessage, 10, 10);      // 제스처 메시지를 지정 위치에 표시
}

/**
 * @brief HandPose 모델이 감지한 손 데이터를 전역 hands 배열에 저장한다.
 * @param {Array} results - 감지된 손 정보
 */
function gotHands(results) {
  hands = results; // 감지된 손 데이터를 전역 배열에 업데이트
}

/**
 * @brief 감지된 손 키포인트를 분석해 특정 제스처를 판별하고, gestureMessage에 저장한다.
 * @param {Object} hand - 감지된 손 데이터
 * @return {string} resultGesture - 판별된 제스처 (Default, Palette, Emergency, ThumbsUp, ThumbsDown 등)
 */
function detectGesture(hand) {
  let resultGesture = "Unknown"; // 초기 제스처 값을 Unknown으로 설정

  if (!hand || !hand.keypoints || hand.keypoints.length < 21) {
    // 유효한 손 데이터가 없는 경우 판별 생략
  } else {
    // 주요 키포인트, 손 크기, 펼쳐짐 여부 등을 분석
    const wrist = hand.keypoints[0];    // 손목 좌표
    const thumbTip = hand.keypoints[4];   // 엄지 끝 좌표
    const indexTip = hand.keypoints[8];   // 검지 끝 좌표
    const middleTip = hand.keypoints[12]; // 중지 끝 좌표
    const ringTip = hand.keypoints[16];   // 약지 끝 좌표
    const pinkyTip = hand.keypoints[20];  // 새끼손가락 끝 좌표

    const handSize = dist(wrist.x, wrist.y, middleTip.x, middleTip.y); // 손의 크기 계산 (손목과 중지 끝 사이의 거리)
    const centroidX = (thumbTip.x + indexTip.x + middleTip.x + ringTip.x + pinkyTip.x) / 5; // 손가락 끝의 x 좌표 평균 계산
    const centroidY = (thumbTip.y + indexTip.y + middleTip.y + ringTip.y + pinkyTip.y) / 5; // 손가락 끝의 y 좌표 평균 계산
    const closeThreshold = handSize * 0.2;  // 손가락 끝들이 모여있는지 판단할 임계값 계산
    const tips = [thumbTip, indexTip, middleTip, ringTip, pinkyTip];
    const allTipsClose = tips.every(tip => dist(tip.x, tip.y, centroidX, centroidY) < closeThreshold); // 모든 손가락 끝이 중심에 가까운지 여부 확인

    const factor = 1.2; // 손가락 확장 여부를 판단하기 위한 계수
    const thumbMCP = hand.keypoints[2]; // 엄지의 중간 관절 좌표
    const thumbExtended = dist(wrist.x, wrist.y, thumbTip.x, thumbTip.y) > factor * dist(wrist.x, wrist.y, thumbMCP.x, thumbMCP.y); // 엄지가 확장되었는지 판단
    const indexMCP = hand.keypoints[5]; // 검지의 중간 관절 좌표
    const indexExtended = dist(wrist.x, wrist.y, indexTip.x, indexTip.y) > factor * dist(wrist.x, wrist.y, indexMCP.x, indexMCP.y); // 검지가 확장되었는지 판단
    const middleMCP = hand.keypoints[9]; // 중지의 중간 관절 좌표
    const middleExtended = dist(wrist.x, wrist.y, middleTip.x, middleTip.y) > factor * dist(wrist.x, wrist.y, middleMCP.x, middleMCP.y); // 중지가 확장되었는지 판단
    const ringMCP = hand.keypoints[13];  // 약지의 중간 관절 좌표
    const ringExtended = dist(wrist.x, wrist.y, ringTip.x, ringTip.y) > factor * dist(wrist.x, wrist.y, ringMCP.x, ringMCP.y); // 약지가 확장되었는지 판단
    const pinkyMCP = hand.keypoints[17]; // 새끼손가락의 중간 관절 좌표
    const pinkyExtended = dist(wrist.x, wrist.y, pinkyTip.x, pinkyTip.y) > factor * dist(wrist.x, wrist.y, pinkyMCP.x, pinkyMCP.y); // 새끼손가락이 확장되었는지 판단

    // 제스처 분기
    if (allTipsClose) {
      resultGesture = "Default"; // 모든 손가락이 모여있으면 기본 제스처로 설정
    } else if (thumbExtended && indexExtended && middleExtended && ringExtended && pinkyExtended) {
      resultGesture = "Palette"; // 모든 손가락이 확장되어 있으면 팔레트 제스처로 설정
    } else if (indexExtended && middleExtended && thumbExtended && !ringExtended && !pinkyExtended) {
      resultGesture = "Emergency"; // 일부 손가락만 확장되면 긴급 제스처로 설정
    } else if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      if (thumbTip.y < thumbMCP.y) {
        resultGesture = "ThumbsUp"; // 엄지만 확장되고 위쪽으로 향하면 ThumbsUp으로 설정
      } else {
        resultGesture = "ThumbsDown"; // 엄지만 확장되었으나 아래쪽이면 ThumbsDown으로 설정
      }
    }
  }

  gestureMessage = `Gesture detected: ${resultGesture}`; // 감지된 제스처를 메시지에 저장
  return resultGesture;  // 판별된 제스처 반환
}

/**
 * @brief 판별된 제스처에 따라 모드 토글(팔레트) 혹은 모드 토큰 설정.
 * @param {string} gesture - 감지된 제스처
 */
function changeMode(gesture) {
  if (gesture === "Palette") {
    paletteActive = !paletteActive; // Palette 제스처이면 팔레트 모드를 토글
    return;
  }
  if (paletteActive) return; // 팔레트 모드 활성 시 다른 제스처 무시

  let modeToken = "";
  if (gesture === "Emergency") {
    modeToken = "PCINT1"; // 긴급 제스처에 대응하는 모드 토큰 설정
  } else if (gesture === "ThumbsUp") {
    modeToken = "PCINT2"; // 엄지 위 제스처에 대응하는 모드 토큰 설정
  } else if (gesture === "ThumbsDown") {
    modeToken = "PCINT3"; // 엄지 아래 제스처에 대응하는 모드 토큰 설정
  } else if (gesture === "Default") {
    modeToken = "Default"; // 기본 제스처인 경우 기본 모드 토큰 설정
  } else {
    return;              // 알 수 없는 제스처일 경우 아무 동작도 하지 않음
  }
  pendingModeToken = modeToken; // 선택된 모드 토큰을 pending 상태로 저장 (전송 대기)
  console.log(`Mode changed to: ${modeToken}`); // 콘솔에 모드 변경 정보 출력
}

/**
 * @brief 팔레트 모드 활성화 시, 손가락 위치로 슬라이더 값을 조정하는 UI를 그린다.
 */
function drawPalette() {
  push(); // 현재 그래픽 상태를 저장하여 후에 복원 가능하도록 함

  let radius = 60; // 각 색상 원의 반지름 설정
  let gap = 40;    // 원 사이의 간격 설정
  let paletteWidth = 3 * (2 * radius) + 2 * gap; // 전체 팔레트의 가로 너비 계산
  let startX = (width - paletteWidth) / 2 + radius; // 팔레트 시작 x 좌표 계산 (중앙 정렬)
  let centerY = 100; // 팔레트 원들의 y 좌표 설정
  
  // 각 팔레트 원 (빨강, 노랑, 초록)
  let redCenterX = startX;                         // 빨강 원의 중심 x 좌표
  let yellowCenterX = startX + (2 * radius + gap);   // 노랑 원의 중심 x 좌표
  let greenCenterX = yellowCenterX + (2 * radius + gap); // 초록 원의 중심 x 좌표
  
  noStroke(); // 원을 그릴 때 테두리 없이 채우기 설정
  fill(255, 0, 0, 150);  // 빨강 색상(투명도 150) 설정
  ellipse(redCenterX, centerY, radius * 2); // 빨강 원 그리기
  fill(255, 255, 0, 150);  // 노랑 색상(투명도 150) 설정
  ellipse(yellowCenterX, centerY, radius * 2); // 노랑 원 그리기
  fill(0, 255, 0, 150);  // 초록 색상(투명도 150) 설정
  ellipse(greenCenterX, centerY, radius * 2); // 초록 원 그리기
  
  if (hands.length > 0) {
    let hand = hands[0];  // 첫 번째 감지된 손 데이터 선택
    let thumbTip = hand.keypoints[4]; // 엄지 끝 좌표 선택
    let indexTip = hand.keypoints[8]; // 검지 끝 좌표 선택
    let thumbX = flipX(thumbTip.x);   // 좌우 반전된 엄지 x 좌표 계산
    let thumbY = thumbTip.y;          // 엄지 y 좌표
    let indexX = flipX(indexTip.x);   // 좌우 반전된 검지 x 좌표 계산
    let indexY = indexTip.y;          // 검지 y 좌표

    // 두 손가락 사이 선 그리기
    stroke(0, 0, 255);      // 파란색 선 설정
    strokeWeight(4);        // 선 두께 설정
    line(thumbX, thumbY, indexX, indexY); // 엄지와 검지 사이 선 그리기
    
    function isInside(x, y, cx, cy, r) {
      return dist(x, y, cx, cy) < r;  // (x,y)가 원의 중심(cx,cy)로부터 r 이내에 있는지 판단
    }
    
    let selectedPaletteCenter = null;
    let selectedColor = null;
    if (isInside(thumbX, thumbY, redCenterX, centerY, radius) && isInside(indexX, indexY, redCenterX, centerY, radius)) {
      selectedPaletteCenter = { x: redCenterX, y: centerY }; // 빨강 원 선택
      selectedColor = "red"; // 선택된 색상 "red" 저장
    } else if (isInside(thumbX, thumbY, yellowCenterX, centerY, radius) && isInside(indexX, indexY, yellowCenterX, centerY, radius)) {
      selectedPaletteCenter = { x: yellowCenterX, y: centerY }; // 노랑 원 선택
      selectedColor = "yellow"; // 선택된 색상 "yellow" 저장
    } else if (isInside(thumbX, thumbY, greenCenterX, centerY, radius) && isInside(indexX, indexY, greenCenterX, centerY, radius)) {
      selectedPaletteCenter = { x: greenCenterX, y: centerY }; // 초록 원 선택
      selectedColor = "green"; // 선택된 색상 "green" 저장
    }
    
    if (selectedPaletteCenter) {
      let fingerDistance = dist(thumbX, thumbY, indexX, indexY); // 엄지와 검지 사이 거리 계산
      let mappedPeriod = map(fingerDistance, 0, 2 * radius, 100, 5000); // 거리를 슬라이더 신호 주기로 매핑
      mappedPeriod = constrain(mappedPeriod, 100, 5000); // 계산된 값을 최소 100, 최대 5000 사이로 제한
      
      let tolerance = 100; // 매핑 값 변화 허용 오차 설정
      if (paletteLastPeriod === null) {
        paletteLastPeriod = mappedPeriod; // 이전 매핑 값이 없으면 초기화
        paletteTimer = 0;                 // 타이머 초기화
      }
      if (abs(mappedPeriod - paletteLastPeriod) < tolerance) {
        paletteTimer += deltaTime;        // 변화가 작으면 타이머 증가
      } else {
        paletteTimer = 0;                 // 변화가 크면 타이머 리셋
        paletteLastPeriod = mappedPeriod; // 현재 매핑 값을 새로운 기준으로 설정
      }
      
      let gaugeProgress = constrain(paletteTimer / 750, 0, 1); // 타이머 비율을 게이지 진행도로 변환
      noFill();
      stroke(0, 0, 255);
      strokeWeight(4);
      arc(
        selectedPaletteCenter.x, selectedPaletteCenter.y,
        radius * 2 + 20, radius * 2 + 20,
        -PI / 2, -PI / 2 + gaugeProgress * TWO_PI  // 게이지 진행 상황을 원형 아크로 표시
      );
      
      if (paletteTimer >= 750) {
        signalPeriod = mappedPeriod; // 충분한 시간이 지나면 신호 주기를 업데이트
        console.log(`Updated signal period to: ${signalPeriod}`); // 업데이트된 주기를 콘솔에 출력
        if (selectedColor === "red") {
          rSlider.value(mappedPeriod); // 선택된 색상에 따라 슬라이더 값 업데이트
        } else if (selectedColor === "yellow") {
          ySlider.value(mappedPeriod);
        } else if (selectedColor === "green") {
          gSlider.value(mappedPeriod);
        }
        paletteTimer = 0;         // 타이머 및 기준 값 리셋
        paletteLastPeriod = null;
      }
      
      noStroke();
      fill(0);
      textSize(16);
      textAlign(CENTER, CENTER);
      text(`Period: ${int(mappedPeriod)}`, selectedPaletteCenter.x, selectedPaletteCenter.y + radius + 30); // 매핑된 신호 주기를 텍스트로 표시
    } else {
      paletteTimer = 0;         // 손가락이 팔레트 영역에 없으면 타이머 리셋
      paletteLastPeriod = null;
    }
  } else {
    paletteTimer = 0;           // 손 데이터가 없으면 타이머 리셋
    paletteLastPeriod = null;
  }
  pop(); // 이전 그래픽 상태로 복원
}

// ----------------------------------------------------
// 4. 헬퍼 함수
//    (flipX)
// ----------------------------------------------------

/**
 * @brief x좌표를 좌우 반전하기 위한 함수 (640 - x).
 * @param {number} x 원본 x좌표
 * @return {number} 뒤집힌 x좌표
 */
function flipX(x) {
  return 640 - x; // 캔버스 폭(640) 기준으로 x 좌표 반전 처리
}

// ----------------------------------------------------
// 5. 시각화 관련 기타 함수
//    (drawHandKeypointsAndSkeleton, getAverageKeypointPosition, drawGestureGauge)
// ----------------------------------------------------

/**
 * @brief 감지된 손 키포인트(빨간 원)와 스켈레톤(초록 선)을 그린다.
 */
function drawHandKeypointsAndSkeleton() {
  for (let i = 0; i < hands.length; i++) {
    let hand = hands[i];
    // 키포인트 (빨간 원)
    for (let j = 0; j < hand.keypoints.length; j++) {
      let kpt = hand.keypoints[j];
      fill(255, 0, 0);          // 키포인트를 빨간색으로 표시
      noStroke();               // 테두리 없이 채움
      circle(flipX(kpt.x), kpt.y, 10); // 좌우 반전된 x 좌표와 y 좌표로 원 그리기
    }
    // 스켈레톤 (초록 선)
    stroke(0, 255, 0);          // 스켈레톤 선 색상을 초록색으로 설정
    strokeWeight(2);            // 선 두께 설정
    for (let c = 0; c < fingerConnections.length; c++) {
      let [a, b] = fingerConnections[c];
      let ptA = hand.keypoints[a];
      let ptB = hand.keypoints[b];
      line(flipX(ptA.x), ptA.y, flipX(ptB.x), ptB.y); // 두 관절을 연결하는 선 그리기
    }
  }
}

/**
 * @brief 첫 번째 손의 키포인트 평균 위치를 계산해 { x, y }로 반환한다.
 * @param {Object} hand 감지된 손 객체
 * @return {Object} 평균 위치 (x, y)
 */
function getAverageKeypointPosition(hand) {
  let sumX = 0, sumY = 0;
  for (let i = 0; i < hand.keypoints.length; i++) {
    sumX += hand.keypoints[i].x; // 각 키포인트의 x 좌표 누적
    sumY += hand.keypoints[i].y; // 각 키포인트의 y 좌표 누적
  }
  return { x: flipX(sumX / hand.keypoints.length), y: sumY / hand.keypoints.length }; // 평균 좌표 계산 후 반환 (x는 좌우 반전)
}

/**
 * @brief 제스처 유지 정도를 게이지 형태로 시각화한다.
 * @param {number} percentage 0~1 범위의 유지 비율
 * @param {Object} avgPos 게이지를 그릴 위치 { x, y }
 */
function drawGestureGauge(percentage, avgPos) {
  let gaugeWidth = width * 0.2;   // 게이지의 가로 길이를 캔버스 너비의 20%로 설정
  let gaugeHeight = 10;           // 게이지의 높이 설정
  let x = avgPos.x - gaugeWidth / 2;  // 게이지의 좌측 시작 x 좌표 계산 (평균 위치를 중앙으로)
  let y = avgPos.y + 70;              // 게이지의 y 좌표를 평균 위치 아래로 설정
  stroke(0);                    // 테두리 색상 설정 (검정)
  noFill();                     // 내부 채움 없이 테두리만 그림
  rect(x, y, gaugeWidth, gaugeHeight); // 게이지 테두리 그리기
  noStroke();                   // 내부 채움 후 테두리 제거
  fill(0, 200, 0, 150);         // 게이지 채움 색상 설정 (녹색, 반투명)
  rect(x, y, gaugeWidth * percentage, gaugeHeight); // 유지 비율에 따라 게이지 채움 영역 그리기
}
