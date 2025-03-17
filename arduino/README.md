# Arduino 신호등 제어 코드

본 문서는 `arduino/src/main.cpp`에 작성된 신호등 제어 코드의 전체 동작 원리와 각 함수의 역할을 설명합니다.

---

## 전체 동작 원리

1. **하드웨어 구성**  
   - **LED (빨강, 노랑, 초록)**: PWM 출력이 가능한 핀(9, 10, 11번)에 연결.  
   - **버튼 3개**: 각각 디지털 핀(2, 3, 4번)과 연결, 내부 풀업 저항(Input Pull-up) 사용.  
   - **가변저항**: 아날로그 핀(A5)에 연결하여 LED 밝기(0~255) 값을 실시간으로 제어.

2. **상태 머신**  
   - `TrafficLight_State` 열거형을 사용해 **빨강 점멸**, **노랑 점멸(2단계)**, **초록 점멸**, **초록 깜빡임**, **노랑 점멸** 과정을 순환하는 신호등 패턴을 구현합니다.  
   - `updateStateMachine()` 함수 내에서 현재 상태를 확인하고, 각 상태가 정해진 시간만큼 유지된 후 다음 상태로 전이합니다.  

3. **모드 전환**  
   - 버튼을 눌러 **모드1(빨강 고정)**, **모드2(전체 LED 토글)**, **모드3(LED 끔)** 을 활성화할 수 있습니다.  
   - 활성화된 모드가 있으면 기본 상태 머신이 동작하지 않고, 해당 모드에 맞춰 LED가 제어됩니다.

4. **TaskScheduler**  
   - 시리얼 입력, 시리얼 출력, 상태 머신 업데이트를 각각의 태스크로 등록하고, `runner.execute()`로 반복 호출합니다.  
   - 이를 통해 여러 작업을 간단히 스케줄링할 수 있습니다.

5. **시리얼 통신**  
   - **시리얼 입력**: 유지 시간을 변경하기 위한 문자열을 수신하여 `intervalRed`, `intervalYellow`, `intervalGreen`을 갱신합니다.  
   - **시리얼 출력**: LED 밝기, 모드, LED ON/OFF 상태를 일정 주기로 출력하여 디버깅 및 모니터링에 활용할 수 있습니다.

6. **가변저항**  
   - `analogRead(POTENTIOMETER)`를 통해 0-1023 범위의 값을 읽고, `map()` 함수로 0-255 범위의 밝기(`brightness`)로 변환합니다.  
   - 이를 통해 LED 밝기를 실시간으로 제어할 수 있습니다.

---

## 주요 함수별 설명

### `setup()`
- **역할**: Arduino 초기 설정, 인터럽트 등록, 태스크 스케줄러 초기화 등을 수행합니다.
- **핵심 동작**:
  1. `Serial.begin(9600)`: 시리얼 통신 속도 9600bps로 시작.
  2. `pinMode(LED_RED, OUTPUT)`, `pinMode(LED_YELLOW, OUTPUT)`, `pinMode(LED_GREEN, OUTPUT)`: LED 핀을 출력 모드로 설정.
  3. `pinMode(BUTTONx, INPUT_PULLUP)`: 버튼 핀을 내부 풀업 모드로 설정.
  4. `attachPCINT(...)`: 핀 체인지 인터럽트를 버튼 핀에 연결, 버튼 눌림 감지.
  5. `runner.init()`: TaskScheduler 초기화.
  6. `runner.addTask(...)`: 상태 머신 업데이트, 시리얼 입력/출력 태스크 등록 후 활성화.
  7. `stateStartTime = millis()`: 상태 머신 타이머 시작 시점 초기화.

### `loop()`
- **역할**: 메인 루프로, 반복 실행되며 주요 작업을 진행합니다.
- **핵심 동작**:
  1. `analogRead(POTENTIOMETER)` → `map()`을 통해 `brightness` 결정.
  2. 모드2(전체 토글)가 활성화되었으면 `renderMode2()`, 아니면 `renderLED()`.
  3. `runner.execute()`로 등록된 태스크들을 스케줄링해 실행.

### `updateStateMachine()`
- **역할**: 신호등 상태 머신을 업데이트하고, 현재 상태에 따라 LED 패턴을 결정합니다.
- **핵심 동작**:
  1. `if (mode1Active || mode2Active || mode3Active) return;`  
     - 모드가 활성화되어 있으면 상태 머신은 동작 중단.
  2. 상태별 분기(`switch(currentState)`)  
     - `BLINK_RED` → 일정 시간 후 `BLINK_YELLOW1`  
     - `BLINK_YELLOW1` → 일정 시간 후 `BLINK_GREEN`  
     - `BLINK_GREEN` → 일정 시간 후 `FLICK_GREEN`  
     - `FLICK_GREEN` → 깜빡임 간격마다 ON/OFF 전환, 정해진 횟수 이상이면 `BLINK_YELLOW2`  
     - `BLINK_YELLOW2` → 일정 시간 후 다시 `BLINK_RED` 로 순환  
  3. 각 상태에서 `ledPattern` 값을 설정해 LED 색상을 변경.

### `renderLED()`
- **역할**: 현재 `ledPattern`과 `brightness`에 따라 LED를 켜거나 끕니다.
- **핵심 동작**:
  - `switch(ledPattern)`으로 PATTERN_RED, PATTERN_YELLOW, PATTERN_GREEN, PATTERN_OFF 등을 구분.
  - `analogWriteRYG(r_val, y_val, g_val)`을 통해 PWM 값 적용.

### `renderMode2()`
- **역할**: 모드2가 활성화되었을 때, 일정 간격(500ms)으로 모든 LED를 ON/OFF 토글합니다.
- **핵심 동작**:
  1. 정적 변수 `prevTime`을 사용해 마지막 토글 시점을 기록.
  2. 500ms가 경과하면 `ledPattern`을 `PATTERN_MODE2_TOGGLE` ↔ `PATTERN_OFF`로 전환.
  3. `PATTERN_MODE2_TOGGLE` 상태에서는 세 LED에 모두 `brightness`를 적용, 그렇지 않으면 0.

### `serialMonitorTaskCallback()`
- **역할**: 일정 주기로 시리얼 모니터에 LED 밝기, 모드, LED 상태를 출력합니다.
- **핵심 동작**:
  1. `Serial.print("B:")` 뒤에 `brightness` 출력.
  2. `Serial.print("M:")` 뒤에 현재 모드 표시(PCINT1, PCINT2, PCINT3, Default).
  3. `Serial.print("O:")` 뒤에 각 LED의 ON/OFF 상태(0 또는 1) 출력.

### `serialInputTaskCallback()`
- **역할**: 시리얼 입력으로부터 유지 시간(예: `intervalRed`, `intervalYellow`, `intervalGreen`)을 업데이트합니다.
- **핵심 동작**:
  1. `Serial.available()`로 수신 데이터가 있는지 확인.
  2. 쉼표 구분(`2000,500,2000`)으로 값을 파싱해 각 `intervalXxx` 변수에 반영.
  3. 값이 올바르면 `Intervals updated to: ...` 메시지를, 아니면 에러 메시지 출력.

### `PCINTCallbackButton1()`, `PCINTCallbackButton2()`, `PCINTCallbackButton3()`
- **역할**: 버튼이 눌릴 때마다 모드 활성/비활성화 토글을 처리합니다.
- **핵심 동작**:
  1. 내부 풀업 상태에서 버튼이 눌리면 핀 상태가 HIGH → LOW로 변환됨.
  2. 모드1(Button1): 빨간 LED 고정, 모드2(Button2): 전체 LED 토글, 모드3(Button3): 모든 LED 끔.
  3. 모드 해제 시에는 `stateStartTime = millis(); currentState = BLINK_RED;` 로 기본 상태 머신 복귀.

### `analogWriteRYG(int r_val, int y_val, int g_val)`
- **역할**: 세 개의 LED에 대해 동시에 PWM 값을 설정합니다.
- **핵심 동작**:
  1. `analogWrite(LED_RED, r_val)`, `analogWrite(LED_YELLOW, y_val)`, `analogWrite(LED_GREEN, g_val)`.
  2. 각각 0~255 범위로 PWM 신호를 전달하여 LED 밝기를 제어.
