// ----------------------------------------------------
// 전역 변수들
// ----------------------------------------------------
let port;
let portConnected = false;
let latestData = "";

// 아두이노에서 수신한 데이터
let brightnessValue = "";
let modeValue = "";
let ledState = [0, 0, 0];

// UI 요소
let connectButton;
let rSlider, ySlider, gSlider;
let lastSentTime = 0;
let sendInterval = 500;

// ml5 HandPose 관련 변수
let handPose;
let video;
let hands = [];

// ----------------------------------------------------
// 추가 전역 변수 (팔레트 모드 관련)
// ----------------------------------------------------
let paletteActive = false;
let paletteStartTime = 0;
let lastPaletteUpdateTime = 0;

// 추가 전역 변수들 (신호 주기 관련)
let signalPeriod = 1000;      // 기본 신호 주기 (ms)
let paletteTimer = 0;         // 안정화 시간 측정 타이머
let paletteLastPeriod = null; // 이전에 측정된 매핑 값

// ----------------------------------------------------
// 스켈레톤 연결 정보
// ----------------------------------------------------
const fingerConnections = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20]
];

// ----------------------------------------------------
// 제스처 인식 및 모드 전환 관련 변수
// ----------------------------------------------------
let pendingModeToken = "";
let lastGesture = "";       // 마지막 감지된 제스처
let gestureTimer = 0;       // 동일 제스처 유지 시간 (ms)
let confirmedGesture = "";  // 최종 확정된 제스처
const gestureThreshold = 1000;  // 1초 유지

// ----------------------------------------------------
// p5.js 사전 로드
// ----------------------------------------------------
function preload() {
  handPose = ml5.handPose();
}

// ----------------------------------------------------
// p5.js 초기화
// ----------------------------------------------------
function setup() {
  let myCanvas = createCanvas(640, 480);
  myCanvas.parent("canvas-container");

  // 웹캠 및 HandPose 설정ㄴ
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  handPose.detectStart(video, gotHands);

  // UI 요소 연결
  connectButton = select("#connectButton");
  connectButton.mousePressed(connectSerial);
  rSlider = select("#rSlider");
  ySlider = select("#ySlider");
  gSlider = select("#gSlider");
}

// ----------------------------------------------------
// p5.js 메인 루프
// ----------------------------------------------------
function draw() {
  // 슬라이더 값 및 모드 전송
  if (portConnected && millis() - lastSentTime > sendInterval) {
    sendSliderValues();
    lastSentTime = millis();
  }

  // 웹캠 영상 출력
  image(video, 0, 0, width, height);

  // HandPose 키포인트 및 스켈레톤 그리기
  drawHandKeypointsAndSkeleton();

  // 제스처 인식 및 안정화 처리 (paletteActive가 false일 때만 게이지 표시)
  if (hands.length > 0) {
    let detectedGesture = detectGesture(hands[0]);
    if (detectedGesture === lastGesture) {
      gestureTimer += deltaTime;
    } else {
      lastGesture = detectedGesture;
      gestureTimer = 0;
    }
    /*
    if (!paletteActive) {
      let avgPos = getAverageKeypointPosition(hands[0]);
      let progress = constrain(gestureTimer / gestureThreshold, 0, 1);
      drawGestureGauge(progress, avgPos);
    }
    */
      let avgPos = getAverageKeypointPosition(hands[0]);
      let progress = constrain(gestureTimer / gestureThreshold, 0, 1);
      drawGestureGauge(progress, avgPos);
    if (gestureTimer >= gestureThreshold && detectedGesture !== confirmedGesture) {
      confirmedGesture = detectedGesture;
      if (paletteActive && confirmedGesture !== "Palette") {
        // 팔레트 모드 활성화 중일 때는 Palette 제스처만 동작
      } else {
        changeMode(confirmedGesture);
      }
    }
  } else {
    gestureTimer = 0;
    lastGesture = "";
    confirmedGesture = "";
    if (!paletteActive) {
      drawGestureGauge(0, { x: width / 2, y: height - 40 });
    }
  }

  // 팔레트 모드 활성화 시, 팔레트 UI 그리기
  if (paletteActive) {
    drawPalette();
  }
}

// ----------------------------------------------------
// HandPose 키포인트 및 스켈레톤 그리기 함수
// ----------------------------------------------------
function drawHandKeypointsAndSkeleton() {
  for (let i = 0; i < hands.length; i++) {
    let hand = hands[i];
    // 키포인트 그리기 (빨간 원)
    for (let j = 0; j < hand.keypoints.length; j++) {
      let kpt = hand.keypoints[j];
      fill(255, 0, 0);
      noStroke();
      circle(640 - kpt.x, kpt.y, 10);
    }
    // 스켈레톤 그리기 (초록 선)
    stroke(0, 255, 0);
    strokeWeight(2);
    for (let c = 0; c < fingerConnections.length; c++) {
      let [a, b] = fingerConnections[c];
      let ptA = hand.keypoints[a];
      let ptB = hand.keypoints[b];
      line(640 - ptA.x, ptA.y, 640 - ptB.x, ptB.y);
    }
  }
}

// ----------------------------------------------------
// HandPose 결과 콜백 함수
// ----------------------------------------------------
function gotHands(results) {
  hands = results;
}

// ----------------------------------------------------
// 제스처 판별 함수
// ----------------------------------------------------
function detectGesture(hand) {
  let resultGesture = "Unknown";

  if (!hand || !hand.keypoints || hand.keypoints.length < 21) {
    // Unknown 그대로 유지
  } else {
    // 주요 키포인트
    const wrist = hand.keypoints[0];
    const thumbTip = hand.keypoints[4];
    const indexTip = hand.keypoints[8];
    const middleTip = hand.keypoints[12];
    const ringTip = hand.keypoints[16];
    const pinkyTip = hand.keypoints[20];

    // 손의 크기 및 중심 계산
    const handSize = dist(wrist.x, wrist.y, middleTip.x, middleTip.y);
    const centroidX = (thumbTip.x + indexTip.x + middleTip.x + ringTip.x + pinkyTip.x) / 5;
    const centroidY = (thumbTip.y + indexTip.y + middleTip.y + ringTip.y + pinkyTip.y) / 5;
    const closeThreshold = handSize * 0.2;
    const tips = [thumbTip, indexTip, middleTip, ringTip, pinkyTip];
    const allTipsClose = tips.every(tip => dist(tip.x, tip.y, centroidX, centroidY) < closeThreshold);

    // 펼쳐짐 여부 판단
    const factor = 1.2;
    const thumbMCP = hand.keypoints[2];
    const thumbExtended = dist(wrist.x, wrist.y, thumbTip.x, thumbTip.y) > factor * dist(wrist.x, wrist.y, thumbMCP.x, thumbMCP.y);
    const indexMCP = hand.keypoints[5];
    const indexExtended = dist(wrist.x, wrist.y, indexTip.x, indexTip.y) > factor * dist(wrist.x, wrist.y, indexMCP.x, indexMCP.y);
    const middleMCP = hand.keypoints[9];
    const middleExtended = dist(wrist.x, wrist.y, middleTip.x, middleTip.y) > factor * dist(wrist.x, wrist.y, middleMCP.x, middleMCP.y);
    const ringMCP = hand.keypoints[13];
    const ringExtended = dist(wrist.x, wrist.y, ringTip.x, ringTip.y) > factor * dist(wrist.x, wrist.y, ringMCP.x, ringMCP.y);
    const pinkyMCP = hand.keypoints[17];
    const pinkyExtended = dist(wrist.x, wrist.y, pinkyTip.x, pinkyTip.y) > factor * dist(wrist.x, wrist.y, pinkyMCP.x, pinkyMCP.y);

    // 제스처 조건 분기
    if (allTipsClose) {
      resultGesture = "Default";
    } else if (thumbExtended && indexExtended && middleExtended && ringExtended && pinkyExtended) {
      resultGesture = "Palette";
    } else if (indexExtended && middleExtended && thumbExtended && !ringExtended && !pinkyExtended) {
      resultGesture = "Peace";
    } else if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      if (thumbTip.y < thumbMCP.y) {
        resultGesture = "ThumbsUp";
      } else {
        resultGesture = "ThumbsDown";
      }
    }
  }

  // 기존: logMessage(`Detected Gesture: ${resultGesture}`);
  // 변경: 첫 번째 인자는 "Gesture", 두 번째 인자는 resultGesture
  logMessage("Gesture", resultGesture);

  return resultGesture;
}

// ----------------------------------------------------
// 첫 번째 손의 키포인트 평균 위치 계산 함수
// ----------------------------------------------------
function getAverageKeypointPosition(hand) {
  let sumX = 0, sumY = 0;
  for (let i = 0; i < hand.keypoints.length; i++) {
    sumX += hand.keypoints[i].x;
    sumY += hand.keypoints[i].y;
  }
  return { x: (640 - sumX / hand.keypoints.length), y: sumY / hand.keypoints.length };
}

// ----------------------------------------------------
// 게이지 UI 그리기 함수
// ----------------------------------------------------
function drawGestureGauge(percentage, avgPos) {
  let gaugeWidth = width * 0.2;
  let gaugeHeight = 10;
  let x = avgPos.x - gaugeWidth / 2;
  let y = avgPos.y + 70;
  stroke(0);
  noFill();
  rect(x, y, gaugeWidth, gaugeHeight);
  noStroke();
  fill(0, 200, 0, 150);
  rect(x, y, gaugeWidth * percentage, gaugeHeight);
}

// ----------------------------------------------------
// 모드 전환 처리 함수
// ----------------------------------------------------
function changeMode(gesture) {
  if (gesture === "Palette") {
    paletteActive = !paletteActive;
    console.log("Palette mode toggled: " + paletteActive);
    return;
  }
  if (paletteActive) return;

  let modeToken = "";
  if (gesture === "Peace") {
    modeToken = "PCINT1";
  } else if (gesture === "ThumbsUp") {
    modeToken = "PCINT2";
  } else if (gesture === "ThumbsDown") {
    modeToken = "PCINT3";
  } else if (gesture === "Default") {
    modeToken = "Default";
  } else {
    return;
  }
  pendingModeToken = modeToken;
  console.log("Mode changed to: " + modeToken);
}

// ----------------------------------------------------
// 슬라이더 값 및 모드 전송 함수
// ----------------------------------------------------
async function sendSliderValues() {
  if (port && port.writable) {
    const encoder = new TextEncoder();
    let modeTokenToSend = pendingModeToken;
    pendingModeToken = "";

    let dataToSend =
      rSlider.value() + "," +
      ySlider.value() + "," +
      gSlider.value() + ",";
    if (modeTokenToSend) {
      dataToSend += modeTokenToSend;
    }
    dataToSend += "\n";

    // 기존: logMessage(`Send to Serial: ${dataToSend.trim()}`);
    // 변경: 첫 번째 인자는 "Sent", 두 번째 인자는 실제 전송 데이터
    logMessage("Sent", dataToSend.trim());

    const writer = port.writable.getWriter();
    await writer.write(encoder.encode(dataToSend));
    writer.releaseLock();
  }
}

// ----------------------------------------------------
// 시리얼 포트 연결 함수
// ----------------------------------------------------
async function connectSerial() {
  try {
    port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    portConnected = true;
    connectButton.html("Serial Connected");
    readLoop();
  } catch (error) {
    console.log("Serial connection error: " + error);
  }
}

// ----------------------------------------------------
// 시리얼 읽기 루프 함수
// ----------------------------------------------------
async function readLoop() {
  const decoder = new TextDecoder();
  while (port.readable) {
    const reader = port.readable.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) {
          latestData += decoder.decode(value);
          if (latestData.indexOf("\n") !== -1) {
            let lines = latestData.split("\n");
            let completeLine = lines[0].trim();
            processSerialData(completeLine);
            latestData = lines.slice(1).join("\n");
          }
        }
      }
    } catch (error) {
      console.log("Read error: " + error);
    } finally {
      reader.releaseLock();
    }
  }
}

// ----------------------------------------------------
// 아두이노 -> PC 데이터 파싱 함수
// ----------------------------------------------------
function processSerialData(dataStr) {
  // 예: "B: 160 M: PCINT2 O: 1,0,1"

  // 기존: logMessage(`Received from Serial: ${dataStr}`);
  // 변경: 첫 번째 인자는 "Received", 두 번째 인자는 실제 데이터
  logMessage("Received", dataStr);

  const pattern = /^B:\s*(\d+)\s*M:\s*(\S+)\s*O:\s*([\d,]+)/;
  const match = dataStr.match(pattern);

  if (match) {
    let newBrightness = match[1];
    let newMode = match[2];
    let ledStates = match[3];

    if (!isNaN(newBrightness) && newBrightness !== "") {
      brightnessValue = newBrightness;
    }
    modeValue = newMode;

    let states = ledStates.split(",");
    if (states.length === 3) {
      ledState[0] = parseInt(states[0]);
      ledState[1] = parseInt(states[1]);
      ledState[2] = parseInt(states[2]);
    }

    updateInfoDisplay();
    updateIndicators();
  }
}


// ----------------------------------------------------
// UI 업데이트 함수들
// ----------------------------------------------------
function updateInfoDisplay() {
  const infoElement = document.getElementById("serialInfo");
  infoElement.textContent = `Brightness : ${brightnessValue} / Mode : ${modeValue}`;
}

function updateIndicators() {
  let bVal = parseInt(brightnessValue);
  if (isNaN(bVal)) bVal = 0;
  const redIndicator = document.getElementById("red-indicator");
  const yellowIndicator = document.getElementById("yellow-indicator");
  const greenIndicator = document.getElementById("green-indicator");
  if (ledState[0] === 1) {
    redIndicator.style.backgroundColor = `rgb(${bVal}, 0, 0)`;
  } else {
    redIndicator.style.backgroundColor = `rgb(${bVal * 0.2}, 0, 0)`;
  }
  if (ledState[1] === 1) {
    yellowIndicator.style.backgroundColor = `rgb(${bVal}, ${bVal}, 0)`;
  } else {
    yellowIndicator.style.backgroundColor = `rgb(${bVal * 0.2}, ${bVal * 0.2}, 0)`;
  }
  if (ledState[2] === 1) {
    greenIndicator.style.backgroundColor = `rgb(0, ${bVal}, 0)`;
  } else {
    greenIndicator.style.backgroundColor = `rgb(0, ${bVal * 0.2}, 0)`;
  }
}
function updateSingleRowTable() {
  const timeCell = document.getElementById("timeCell");
  const gestureCell = document.getElementById("gestureCell");
  const sentCell = document.getElementById("sentCell");
  const receivedCell = document.getElementById("receivedCell");

  // 현재 시각 (시:분:초)
  const nowTime = new Date().toLocaleTimeString();

  // 각각 덮어쓰기
  if (timeCell) timeCell.textContent = nowTime;
  if (gestureCell) gestureCell.textContent = lastGesture;
  if (sentCell) sentCell.textContent = lastSent;
  if (receivedCell) receivedCell.textContent = lastReceived;
}

function logMessage(logType, message) {
  // 현재 시각
  const timestamp = new Date().toLocaleTimeString();

  // 테이블 셀 가져오기
  const timeCell = document.getElementById("timeCell");
  const typeCell = document.getElementById("typeCell");
  const contentCell = document.getElementById("contentCell");

  // 각각 최신 값으로 갱신
  if (timeCell) timeCell.textContent = timestamp;
  if (typeCell) typeCell.textContent = logType;
  if (contentCell) contentCell.textContent = message;
}


// ----------------------------------------------------
// 팔레트 UI 그리기 함수
// ----------------------------------------------------
function drawPalette() {
  let radius = 60; // 큰 원의 반지름
  let gap = 40;    // 원 사이 간격
  let paletteWidth = 3 * (2 * radius) + 2 * gap;
  let startX = (width - paletteWidth) / 2 + radius;
  let centerY = 100;
  
  // 각 팔레트 원의 중심 좌표
  let redCenterX = startX;
  let yellowCenterX = startX + (2 * radius + gap);
  let greenCenterX = yellowCenterX + (2 * radius + gap);
  
  noStroke();
  fill(255, 0, 0, 150);
  ellipse(redCenterX, centerY, radius * 2);
  fill(255, 255, 0, 150);
  ellipse(yellowCenterX, centerY, radius * 2);
  fill(0, 255, 0, 150);
  ellipse(greenCenterX, centerY, radius * 2);
  
  // 팔레트 모드일 때, 손가락 처리
  if (hands.length > 0) {
    let hand = hands[0];
    let thumbTip = hand.keypoints[4];
    let indexTip = hand.keypoints[8];
    let thumbX = 640 - thumbTip.x;
    let thumbY = thumbTip.y;
    let indexX = 640 - indexTip.x;
    let indexY = indexTip.y;
    
    // 두 손가락 사이의 선 그리기
    stroke(0, 0, 255);
    strokeWeight(4);
    line(thumbX, thumbY, indexX, indexY);
    
    function isInside(x, y, cx, cy, r) {
      return dist(x, y, cx, cy) < r;
    }
    
    let selectedPaletteCenter = null;
    let selectedColor = null;
    if (isInside(thumbX, thumbY, redCenterX, centerY, radius) && isInside(indexX, indexY, redCenterX, centerY, radius)) {
      selectedPaletteCenter = { x: redCenterX, y: centerY };
      selectedColor = "red";
    } else if (isInside(thumbX, thumbY, yellowCenterX, centerY, radius) && isInside(indexX, indexY, yellowCenterX, centerY, radius)) {
      selectedPaletteCenter = { x: yellowCenterX, y: centerY };
      selectedColor = "yellow";
    } else if (isInside(thumbX, thumbY, greenCenterX, centerY, radius) && isInside(indexX, indexY, greenCenterX, centerY, radius)) {
      selectedPaletteCenter = { x: greenCenterX, y: centerY };
      selectedColor = "green";
    }
    
    if (selectedPaletteCenter) {
      let fingerDistance = dist(thumbX, thumbY, indexX, indexY);
      let mappedPeriod = map(fingerDistance, 0, 2 * radius, 100, 5000);
      mappedPeriod = constrain(mappedPeriod, 100, 5000);
      
      let tolerance = 100;
      if (paletteLastPeriod === null) {
        paletteLastPeriod = mappedPeriod;
        paletteTimer = 0;
      }
      if (abs(mappedPeriod - paletteLastPeriod) < tolerance) {
        paletteTimer += deltaTime;
      } else {
        paletteTimer = 0;
        paletteLastPeriod = mappedPeriod;
      }
      
      let gaugeProgress = constrain(paletteTimer / 750, 0, 1);
      noFill();
      stroke(0, 0, 255);
      strokeWeight(4);
      arc(selectedPaletteCenter.x, selectedPaletteCenter.y, radius * 2 + 20, radius * 2 + 20, -PI/2, -PI/2 + gaugeProgress * TWO_PI);
      
      if (paletteTimer >= 750) {
        signalPeriod = mappedPeriod;
        console.log("Updated signal period to: " + signalPeriod);
        if (selectedColor === "red") {
          rSlider.value(mappedPeriod);
        } else if (selectedColor === "yellow") {
          ySlider.value(mappedPeriod);
        } else if (selectedColor === "green") {
          gSlider.value(mappedPeriod);
        }
        paletteTimer = 0;
        paletteLastPeriod = null;
      }
      
      noStroke();
      fill(0);
      textSize(16);
      textAlign(CENTER, CENTER);
      text("Period: " + int(mappedPeriod), selectedPaletteCenter.x, selectedPaletteCenter.y + radius + 30);
    } else {
      paletteTimer = 0;
      paletteLastPeriod = null;
    }
  } else {
    paletteTimer = 0;
    paletteLastPeriod = null;
  }
}
