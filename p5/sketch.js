// ----------------------------------------------------
// 전역 변수들
// ----------------------------------------------------

// 아두이노에서 수신하는 시리얼 통신 관련
let port;
let portConnected = false;
let latestData = "";

// 아두이노에서 수신한 데이터 (LED 밝기, 모드, LED 상태)
let brightnessValue = "";
let modeValue = "";
let ledState = [0, 0, 0];

// UI 요소 (버튼, 슬라이더 등)
let connectButton;
let rSlider, ySlider, gSlider;
let lastSentTime = 0;
let sendInterval = 500;

// ml5 HandPose 관련
let handPose;
let video;
let hands = [];

// 팔레트 모드 관련
let paletteActive = false;

// 신호 주기(슬라이더 매핑) 관련
let signalPeriod = 1000;      // 기본 신호 주기 (ms)
let paletteTimer = 0;         // 안정화 시간 측정 타이머
let paletteLastPeriod = null; // 이전에 측정된 매핑 값

// 화면에 표시할 제스처 메시지
let gestureMessage = "";

// 스켈레톤 연결 정보
const fingerConnections = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [0,9],[9,10],[10,11],[11,12],
  [0,13],[13,14],[14,15],[15,16],
  [0,17],[17,18],[18,19],[19,20]
];

// 제스처 인식 및 모드 전환
let pendingModeToken = "";
let lastGesture = "";       // 마지막 감지된 제스처
let gestureTimer = 0;       // 동일 제스처 유지 시간 (ms)
let confirmedGesture = "";  // 최종 확정된 제스처
const gestureThreshold = 1000;  // 1초 유지

// ----------------------------------------------------
// 1. 시리얼 통신 관련
//    (connectSerial, readLoop, processSerialData, sendSliderValues)
// ----------------------------------------------------

/**
 * @brief 브라우저 시리얼 API를 통해 포트를 요청하고 연결 후, readLoop()를 시작한다.
 */
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

/**
 * @brief 시리얼 포트에서 데이터를 지속적으로 읽어와 processSerialData()에 전달한다.
 */
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
      console.log("Read error:", error);
    } finally {
      reader.releaseLock();
    }
  }
}

/**
 * @brief 아두이노 -> PC 데이터 파싱 함수. LED 상태 및 모드를 갱신한다.
 * @param {string} dataStr 수신된 문자열
 */
function processSerialData(dataStr) {
  // 예: "B: 160 M: PCINT2 O: 1,0,1"
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

/**
 * @brief 슬라이더 값 및 모드 토큰을 시리얼 포트로 전송한다.
 */
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

    // 시리얼 전송
    const writer = port.writable.getWriter();
    await writer.write(encoder.encode(dataToSend));
    writer.releaseLock();
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
  const infoElement = document.getElementById("serialInfo");
  infoElement.textContent = `Brightness : ${brightnessValue} / Mode : ${modeValue}`;
}

/**
 * @brief ledState 배열을 기반으로 각 LED 인디케이터 색상 업데이트
 */
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

// ----------------------------------------------------
// 3. 영상, 제스처 관련
//    (preload, gotHands, detectGesture, changeMode, drawPalette,
//     그리고 setup(), draw()도 여기 포함)
// ----------------------------------------------------

/**
 * @brief ml5.js의 HandPose 모델을 미리 로드한다.
 */
function preload() {
  handPose = ml5.handPose();
}

/**
 * @brief p5.js 초기화 함수. 웹캠, HandPose 설정 및 UI 요소 연결
 */
function setup() {
  let myCanvas = createCanvas(640, 480);
  myCanvas.parent("canvas-container");

  // 웹캠 및 HandPose
  video = createCapture(VIDEO, { flipped: true });
  video.size(640, 480);
  video.hide();
  handPose.detectStart(video, gotHands);

  // UI 버튼 및 슬라이더
  connectButton = select("#connectButton");
  connectButton.mousePressed(connectSerial);
  rSlider = select("#rSlider");
  ySlider = select("#ySlider");
  gSlider = select("#gSlider");
}

/**
 * @brief p5.js 메인 루프. 매 프레임마다 웹캠 영상, 제스처, 팔레트 모드 등을 처리한다.
 */
function draw() {
  // 슬라이더 값 및 모드 전송
  if (portConnected && millis() - lastSentTime > sendInterval) {
    sendSliderValues();
    lastSentTime = millis();
  }

  // 웹캠 영상
  image(video, 0, 0, width, height);

  // HandPose 키포인트 및 스켈레톤
  drawHandKeypointsAndSkeleton();

  // 제스처 인식 및 안정화
  if (hands.length > 0) {
    let detectedGesture = detectGesture(hands[0]);
    if (detectedGesture === lastGesture) {
      gestureTimer += deltaTime;
    } else {
      lastGesture = detectedGesture;
      gestureTimer = 0;
    }
    let avgPos = getAverageKeypointPosition(hands[0]);
    let progress = constrain(gestureTimer / gestureThreshold, 0, 1);
    drawGestureGauge(progress, avgPos);

    // 제스처 확정
    if (gestureTimer >= gestureThreshold && detectedGesture !== confirmedGesture) {
      confirmedGesture = detectedGesture;
      if (paletteActive && confirmedGesture !== "Palette") {
        // 팔레트 모드 활성화 중에는 Palette만 동작
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

  // 팔레트 모드
  if (paletteActive) {
    drawPalette();
  }

  // 화면 좌측 상단에 제스처 메시지 표시
  fill(255);
  textSize(16);
  textAlign(LEFT, TOP);
  text(gestureMessage, 10, 10);
}

/**
 * @brief HandPose 모델이 감지한 손 데이터를 전역 hands 배열에 저장한다.
 * @param {Array} results - 감지된 손 정보
 */
function gotHands(results) {
  hands = results;
}

/**
 * @brief 감지된 손 키포인트를 분석해 특정 제스처를 판별하고, gestureMessage에 저장한다.
 * @param {Object} hand - 감지된 손 데이터
 * @return {string} resultGesture - 판별된 제스처 (Default, Palette, Emergency, ThumbsUp, ThumbsDown 등)
 */
function detectGesture(hand) {
  let resultGesture = "Unknown";

  if (!hand || !hand.keypoints || hand.keypoints.length < 21) {
    // Unknown 그대로 유지
  } else {
    // 주요 키포인트, 손 크기, 펼쳐짐 여부 등을 분석
    const wrist = hand.keypoints[0];
    const thumbTip = hand.keypoints[4];
    const indexTip = hand.keypoints[8];
    const middleTip = hand.keypoints[12];
    const ringTip = hand.keypoints[16];
    const pinkyTip = hand.keypoints[20];

    const handSize = dist(wrist.x, wrist.y, middleTip.x, middleTip.y);
    const centroidX = (thumbTip.x + indexTip.x + middleTip.x + ringTip.x + pinkyTip.x) / 5;
    const centroidY = (thumbTip.y + indexTip.y + middleTip.y + ringTip.y + pinkyTip.y) / 5;
    const closeThreshold = handSize * 0.2;
    const tips = [thumbTip, indexTip, middleTip, ringTip, pinkyTip];
    const allTipsClose = tips.every(tip => dist(tip.x, tip.y, centroidX, centroidY) < closeThreshold);

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

    // 제스처 분기
    if (allTipsClose) {
      resultGesture = "Default";
    } else if (thumbExtended && indexExtended && middleExtended && ringExtended && pinkyExtended) {
      resultGesture = "Palette";
    } else if (indexExtended && middleExtended && thumbExtended && !ringExtended && !pinkyExtended) {
      resultGesture = "Emergency";
    } else if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
      if (thumbTip.y < thumbMCP.y) {
        resultGesture = "ThumbsUp";
      } else {
        resultGesture = "ThumbsDown";
      }
    }
  }

  gestureMessage = `Gesture detected: ${resultGesture}`;
  return resultGesture;
}

/**
 * @brief 판별된 제스처에 따라 모드 토글(팔레트) 혹은 모드 토큰 설정.
 * @param {string} gesture - 감지된 제스처
 */
function changeMode(gesture) {
  if (gesture === "Palette") {
    paletteActive = !paletteActive;
    return;
  }
  if (paletteActive) return;

  let modeToken = "";
  if (gesture === "Emergency") {
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
  console.log(`Mode changed to: ${modeToken}`);
}

/**
 * @brief 팔레트 모드 활성화 시, 손가락 위치로 슬라이더 값을 조정하는 UI를 그린다.
 */
function drawPalette() {
  push(); // 그래픽 상태 저장

  let radius = 60; // 큰 원의 반지름
  let gap = 40;    // 원 사이 간격
  let paletteWidth = 3 * (2 * radius) + 2 * gap;
  let startX = (width - paletteWidth) / 2 + radius;
  let centerY = 100;
  
  // 각 팔레트 원 (빨강, 노랑, 초록)
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
  
  if (hands.length > 0) {
    let hand = hands[0];
    let thumbTip = hand.keypoints[4];
    let indexTip = hand.keypoints[8];
    let thumbX = flipX(thumbTip.x);
    let thumbY = thumbTip.y;
    let indexX = flipX(indexTip.x);
    let indexY = indexTip.y;

    // 두 손가락 사이 선
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
      arc(
        selectedPaletteCenter.x, selectedPaletteCenter.y,
        radius * 2 + 20, radius * 2 + 20,
        -PI / 2, -PI / 2 + gaugeProgress * TWO_PI
      );
      
      if (paletteTimer >= 750) {
        signalPeriod = mappedPeriod;
        console.log(`Updated signal period to: ${signalPeriod}`);
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
      text(`Period: ${int(mappedPeriod)}`, selectedPaletteCenter.x, selectedPaletteCenter.y + radius + 30);
    } else {
      paletteTimer = 0;
      paletteLastPeriod = null;
    }
  } else {
    paletteTimer = 0;
    paletteLastPeriod = null;
  }
  pop(); // 그래픽 상태 복원
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
  return 640 - x;
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
      fill(255, 0, 0);
      noStroke();
      circle(flipX(kpt.x), kpt.y, 10);
    }
    // 스켈레톤 (초록 선)
    stroke(0, 255, 0);
    strokeWeight(2);
    for (let c = 0; c < fingerConnections.length; c++) {
      let [a, b] = fingerConnections[c];
      let ptA = hand.keypoints[a];
      let ptB = hand.keypoints[b];
      line(flipX(ptA.x), ptA.y, flipX(ptB.x), ptB.y);
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
    sumX += hand.keypoints[i].x;
    sumY += hand.keypoints[i].y;
  }
  return { x: flipX(sumX / hand.keypoints.length), y: sumY / hand.keypoints.length };
}

/**
 * @brief 제스처 유지 정도를 게이지 형태로 시각화한다.
 * @param {number} percentage 0~1 범위의 유지 비율
 * @param {Object} avgPos 게이지를 그릴 위치 { x, y }
 */
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
