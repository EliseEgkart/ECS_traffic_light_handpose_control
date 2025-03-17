# p5.js 웹 인터페이스

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
