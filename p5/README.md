## (확장) p5.js 웹 인터페이스

이 섹션은 기존 p5.js 기반 웹 인터페이스에 **HandPose(ml5.js)**를 활용한 **손동작(제스처) 인식**과 **팔레트 모드** 기능을 추가로 도입한 버전을 설명합니다.  
기존 코드의 전반적인 구조(시리얼 통신, 슬라이더 전송, UI 업데이트 등)는 유지하면서, 제스처 인식 로직과 팔레트 모드가 확장되었습니다.

---

## 전체 동작 원리

1. **웹캠 영상 및 손동작 인식**  
   - `preload()`에서 HandPose 모델을 로드한 뒤, `setup()`에서 `handPose.detectStart(video, gotHands)`를 호출해 실시간 웹캠 영상을 분석합니다.  
   - 매 프레임(`draw()`)마다 감지된 손 키포인트를 스켈레톤으로 표시하고, `detectGesture()`로 제스처를 판별해 필요한 모드를 전환합니다.

2. **팔레트 모드 추가**  
   - 기존에는 빨강·노랑·초록 슬라이더를 통해 LED 주기를 변경했지만, 이제는 `drawPalette()` 함수를 통해 화면에 표시된 **빨강·노랑·초록 원** 위에 손가락(엄지·검지)을 올려놓으면 LED 주기를 직관적으로 조절할 수 있습니다.  
   - 750ms 동안 동일 거리를 유지하면 실제 슬라이더 값도 갱신되어 아두이노 측에 반영됩니다.

3. **쿨다운(gestureTimer) 기반 모드 전환**  
   - 긴급(Emergency), 엄지 위(ThumbsUp), 엄지 아래(ThumbsDown), 팔레트(Palette) 등 제스처가 **1초간 동일**하게 유지되어야 모드 전환이 이뤄집니다.  
   - 이를 통해 손동작이 순간적으로 흔들려도 잘못 모드가 바뀌지 않도록 안정성을 확보합니다.

4. **시리얼 통신 및 UI 업데이트**  
   - 시리얼 통신(`connectSerial`, `readLoop`, `sendSliderValues`, `processSerialData`) 로직은 기존과 동일하게 동작합니다.  
   - 수신된 LED 상태와 밝기는 `updateIndicators()`와 `updateInfoDisplay()`로 반영되고, 슬라이더 값은 주기적으로 아두이노로 전송됩니다.

---

## 주요 동작별 함수별 설명

### **시리얼 통신 관련**  
- **`connectSerial()`**  
  - 기존과 동일하게 브라우저 시리얼 API를 통해 포트 연결.  
  - 연결 성공 시 `portConnected = true`로 설정하고, `readLoop()` 호출로 데이터 수신 시작.
- **`readLoop()`**  
  - 수신된 바이트 스트림을 문자열로 누적(`latestData`), 줄바꿈(`\n`) 기준으로 분할해 `processSerialData()`에 전달.
- **`processSerialData(dataStr)`**  
  - 밝기(B), 모드(M), LED 상태(O) 값을 정규표현식으로 추출 후, UI 업데이트 함수 호출.
- **`sendSliderValues()`**  
  - 슬라이더(`rSlider`, `ySlider`, `gSlider`) 값과 `pendingModeToken`을 쉼표 구분으로 전송.  
  - 팔레트 모드에서 주기가 변경될 때도 이 함수를 통해 아두이노 측에 반영.

### **디스플레이 인디케이터 업데이트**  
- **`updateInfoDisplay()`**  
  - 밝기(`brightnessValue`), 모드(`modeValue`)를 HTML 요소(`#serialInfo`)에 표시.
- **`updateIndicators()`**  
  - `ledState` 값(0/1)에 따라 빨강·노랑·초록 LED 인디케이터 색상 결정.  
  - `brightnessValue`에 따라 색상 밝기(`bVal`, `bVal*0.2`)를 조절해 LED가 켜짐/꺼짐 상태를 시각화.

### **영상, 제스처 관련**  
- **`preload()`**  
  - **HandPose** 모델을 로드.  
- **`setup()`**  
  - 기존과 동일하게 캔버스 생성, 시리얼 연결 버튼 설정.  
  - `handPose.detectStart(video, gotHands)`를 통해 웹캠 영상을 분석 시작.  
- **`draw()`**  
  1. 주기(`sendInterval`)마다 슬라이더 값 전송.  
  2. 웹캠 영상을 그리고, `drawHandKeypointsAndSkeleton()`로 손 키포인트와 스켈레톤 표시.  
  3. `detectGesture()`로 판별된 제스처가 1초 유지되면(`gestureTimer`), `changeMode()`로 모드 전환.  
  4. **팔레트 모드**(`paletteActive`)가 true이면 `drawPalette()`를 호출해 색상 팔레트 UI를 표시.
- **`gotHands(results)`**  
  - HandPose가 감지한 손 정보를 `hands` 배열에 저장.  
- **`detectGesture(hand)`**  
  - 엄지·검지·중지·약지·새끼 손가락 펼쳐짐 여부를 분석해 Emergency, ThumbsUp, ThumbsDown, Palette, Default 등으로 분기.  
  - 제스처 메시지(`gestureMessage`)를 갱신.
- **`changeMode(gesture)`**  
  - 제스처에 맞춰 **`pendingModeToken`**을 설정하거나, 팔레트 모드를 토글.  
  - 예: Emergency → `PCINT1`, ThumbsUp → `PCINT2`, ThumbsDown → `PCINT3`, Default → `"Default"`.

### **헬퍼 함수**  
- **`flipX(x)`**  
  - 웹캠이 좌우 반전된 상태이므로, x좌표를 `640 - x`로 뒤집어 표시.

### **시각화 관련 기타 함수**  
- **`drawHandKeypointsAndSkeleton()`**  
  - 빨간 원으로 키포인트를 표시, 초록 선으로 스켈레톤을 연결해 손 구조를 시각적으로 보여줌.
- **`getAverageKeypointPosition(hand)`**  
  - 손 키포인트 평균 위치를 계산해 쿨다운 게이지(`drawGestureGauge`)나 팔레트 모드 표시 등에 사용.
- **`drawGestureGauge(percentage, avgPos)`**  
  - 제스처 유지 시간을 0~1 범위(`percentage`)로 환산해 게이지로 표현.  
  - 사용자가 1초 쿨다운이 얼마나 진행됐는지 한눈에 파악 가능.
---

## 전체 동작 원리

1. **시리얼 포트 연결**  
   - 사용자가 “Connect Serial” 버튼을 클릭하면, 브라우저에서 Arduino 시리얼 포트를 선택할 수 있습니다.  
   - 선택된 포트가 연결되면 `portConnected` 변수가 `true`가 되어, 주기적으로 슬라이더 값을 Arduino에 전송하고, Arduino에서 전송되는 데이터를 읽어 UI를 업데이트합니다.

2. **슬라이더 제어**  
   - 빨강(`rSlider`), 노랑(`ySlider`), 초록(`gSlider`) 슬라이더 값을 500ms 간격(`sendInterval`)으로 Arduino에 전송합니다.  
   - Arduino는 이 값을 받아 LED 지속 시간을 조정하거나, 원하는 방식으로 활용할 수 있습니다.

3. **시리얼 데이터 수신 및 파싱**  
   - Arduino로부터 받은 데이터(예: `B: 160 M: PCINT2 O: 1,0,1`)를 해석하여  
     - **밝기(`brightnessValue`)**  
     - **모드(`modeValue`)**  
     - **LED 상태(`ledState`)**  
     를 추출합니다.  
   - 추출된 정보는 UI에 실시간으로 반영되어, 신호등 인디케이터 색상과 시리얼 정보 영역을 업데이트합니다.

4. **UI 업데이트**  
   - 빨강, 노랑, 초록 LED 인디케이터는 `ledState` 값(0 또는 1)에 따라 색상이 바뀌며, `brightnessValue`를 바탕으로 색상의 밝기를 조절합니다.  
   - 모드 정보는 사용자에게 친숙한 문자열(Mode1, Mode2, Mode3, Default)로 변환해 표시합니다.

---

# (기존) p5.js 웹 인터페이스

이 폴더(`p5`)는 웹 브라우저를 통해 Arduino와 시리얼 통신을 수행하며, LED 상태와 지속 시간을 조절할 수 있는 UI를 제공하는 코드를 담고 있습니다. **Web Serial API**와 **p5.js**를 활용하여 직관적인 인터페이스를 구현하였습니다.

---

## 전체 동작 원리

1. **시리얼 포트 연결**  
   - 사용자가 “Connect Serial” 버튼을 클릭하면, 브라우저에서 Arduino 시리얼 포트를 선택할 수 있습니다.  
   - 선택된 포트가 연결되면 `portConnected` 변수가 `true`가 되어, 주기적으로 슬라이더 값을 Arduino에 전송하고, Arduino에서 전송되는 데이터를 읽어 UI를 업데이트합니다.

2. **슬라이더 제어**  
   - 빨강(`rSlider`), 노랑(`ySlider`), 초록(`gSlider`) 슬라이더 값을 500ms 간격(`sendInterval`)으로 Arduino에 전송합니다.  
   - Arduino는 이 값을 받아 LED 지속 시간을 조정하거나, 원하는 방식으로 활용할 수 있습니다.

3. **시리얼 데이터 수신 및 파싱**  
   - Arduino로부터 받은 데이터(예: `B: 160 M: PCINT2 O: 1,0,1`)를 해석하여  
     - **밝기(`brightnessValue`)**  
     - **모드(`modeValue`)**  
     - **LED 상태(`ledState`)**  
     를 추출합니다.  
   - 추출된 정보는 UI에 실시간으로 반영되어, 신호등 인디케이터 색상과 시리얼 정보 영역을 업데이트합니다.

4. **UI 업데이트**  
   - 빨강, 노랑, 초록 LED 인디케이터는 `ledState` 값(0 또는 1)에 따라 색상이 바뀌며, `brightnessValue`를 바탕으로 색상의 밝기를 조절합니다.  
   - 모드 정보는 사용자에게 친숙한 문자열(Mode1, Mode2, Mode3, Default)로 변환해 표시합니다.

---

## 주요 함수별 설명

### 전역 변수

- **`port`**  
  시리얼 포트 객체. `navigator.serial.requestPort()`로 얻어옴.
- **`portConnected`**  
  시리얼 포트 연결 상태를 나타내는 불리언 값.
- **`latestData`**  
  누적된 수신 데이터 문자열을 저장하는 버퍼.
- **`brightnessValue`, `modeValue`, `ledState`**  
  Arduino에서 수신한 데이터(밝기, 모드, LED 상태)를 파싱해 저장.
- **`connectButton`, `rSlider`, `ySlider`, `gSlider`**  
  HTML 요소를 p5.dom으로 선택해 저장한 변수. (버튼, 슬라이더 등)
- **`lastSentTime`, `sendInterval`**  
  마지막으로 슬라이더 값을 전송한 시각과 전송 주기를 제어.

### `setup()`
- **역할**: 페이지가 로드된 후 초기 설정을 수행합니다.
- **핵심 동작**:
  1. `connectButton = select("#connectButton")`  
     - HTML 문서에서 ID가 `connectButton`인 버튼을 선택하고, 클릭 시 `connectSerial()` 함수를 호출하도록 설정.
  2. 슬라이더 요소(`rSlider`, `ySlider`, `gSlider`)를 선택해 나중에 값 전송에 활용.
  3. `draw()` 함수 대신 setInterval 등으로 반복 작업을 수행할 수도 있지만, 여기서는 `draw()`를 사용.

### `draw()`
- **역할**: p5.js의 메인 루프 함수로, 매 프레임마다 호출됩니다.
- **핵심 동작**:
  1. `if (portConnected && millis() - lastSentTime > sendInterval)`  
     - 시리얼이 연결되어 있고, 마지막 전송 후 `sendInterval`(500ms)이 지났는지 확인.
  2. `sendSliderValues()`를 호출해 슬라이더 값을 전송하고, `lastSentTime` 업데이트.

### `connectSerial()`
- **역할**: 사용자가 시리얼 연결 버튼을 클릭했을 때, 시리얼 포트를 요청하고 연결을 시도하는 비동기 함수.
- **핵심 동작**:
  1. `port = await navigator.serial.requestPort();`  
     - 브라우저에서 시리얼 포트 선택 대화상자를 열어 사용자에게 포트를 선택하도록 함.
  2. `await port.open({ baudRate: 9600 });`  
     - 선택한 포트를 보오율 9600으로 열어 통신 준비.
  3. `portConnected = true;` 로 상태 업데이트 후, 버튼 텍스트를 “Serial Connected”로 변경.
  4. `readLoop()`를 호출하여 데이터 수신을 시작.

### `readLoop()`
- **역할**: 시리얼 포트에서 데이터를 지속적으로 읽어들이는 비동기 함수.
- **핵심 동작**:
  1. `const decoder = new TextDecoder();`  
     - 바이트 스트림을 문자열로 변환하기 위한 디코더 생성.
  2. 포트가 읽기 가능한 동안, `reader.read()`를 통해 반복적으로 데이터 수신.
  3. `latestData`에 누적된 문자열 중 `\n`(개행 문자)이 있으면 한 줄씩 분할해 `processSerialData()`로 전달.
  4. 모든 데이터 처리 후, `reader.releaseLock()`으로 잠금을 해제하여 다음 읽기 작업이 가능하도록 함.

### `processSerialData(dataStr)`
- **역할**: 수신한 한 줄의 문자열을 파싱해 `brightnessValue`, `modeValue`, `ledState`를 업데이트.
- **핵심 동작**:
  1. 정규표현식(`^B:\s*(\d+)\s*M:\s*(\S+)\s*O:\s*([\d,]+)`)을 사용해 밝기(B), 모드(M), LED 상태(O)를 추출.
  2. 추출한 값을 각각 변수에 저장 후, `updateInfoDisplay()`, `updateIndicators()` 호출로 UI 업데이트.

### `sendSliderValues()`
- **역할**: 슬라이더(`rSlider`, `ySlider`, `gSlider`) 값을 시리얼 포트를 통해 Arduino로 전송.
- **핵심 동작**:
  1. `port.writable`인지 확인하여, 포트가 쓰기 가능한 상태인지 확인.
  2. 슬라이더 값들을 `"값1,값2,값3\n"` 형태로 조합해 TextEncoder로 인코딩 후 전송.
  3. 전송 후 `writer.releaseLock()`으로 잠금을 해제.

### `updateInfoDisplay()`
- **역할**: HTML 요소(예: `#serialInfo`)의 텍스트를 현재 `brightnessValue`, `modeValue`로 갱신.
- **핵심 동작**:
  1. `document.getElementById("serialInfo")`를 통해 요소를 선택.
  2. `infoElement.textContent = …` 로 표시할 문자열 설정.

### `updateIndicators()`
- **역할**: LED 상태(ledState)와 밝기(brightnessValue)에 따라 신호등 인디케이터 색상을 갱신.
- **핵심 동작**:
  1. 빨강, 노랑, 초록 인디케이터 각각에 대해 ledState가 1이면 LED가 켜진 색상, 0이면 어두운 색상 적용.
  2. `brightnessValue`를 숫자로 변환하여 RGB 값에 반영.  
     - 예: `redIndicator.style.backgroundColor = rgb(bVal, 0, 0)`  
     - LED가 꺼진 상태면 `bVal * 0.2`로 약간 어둡게 표시.