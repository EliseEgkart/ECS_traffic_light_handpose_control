# (확장) Arduino 신호등 제어 코드

아두이노 코드는 전체적인 로직(상태 머신, 버튼 인터럽트, TaskScheduler 등)에 큰 변화가 없지만,  
**시리얼 입력 태스크(`serialInputTaskCallback()`)**에서 **모드 변경** 기능을 함께 처리하도록 확장했습니다.  
이 아래에서는 (기존 코드)와 (확장 코드)를 비교하고, **어떤 점이 달라졌는지**를 정리합니다.

---

## 기능의 변동사항: `serialInputTaskCallback()` 함수

### (기존 코드 )

```cpp
// -------------------------
// (기존) 시리얼 입력 태스크: 외부에서 LED 유지시간을 업데이트하기 위한 입력 처리
// -------------------------
/**
 * @brief 시리얼로부터 입력받은 문자열을 파싱하여 LED 유지시간(intervalRed, intervalYellow, intervalGreen)을 갱신한다.
 *
 * 입력 형식: "2000,500,2000" 처럼 쉼표로 구분된 세 개의 정수값을 기대.
 */
void serialInputTaskCallback() {
  // 시리얼 버퍼에 데이터가 있을 때 처리
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');  // 개행 문자까지 읽음
    input.trim();  // 문자열 양쪽의 공백 제거
    if (input.length() > 0) {
      int firstComma = input.indexOf(',');
      int secondComma = input.indexOf(',', firstComma + 1);
      if (firstComma != -1 && secondComma != -1) {
        unsigned int newRed = input.substring(0, firstComma).toInt();
        unsigned int newYellow = input.substring(firstComma + 1, secondComma).toInt();
        unsigned int newGreen = input.substring(secondComma + 1).toInt();

        if (newRed > 0 && newYellow > 0 && newGreen > 0) {
          intervalRed = newRed;
          intervalYellow = newYellow;
          intervalGreen = newGreen;
          Serial.print("Intervals updated to: ");
          Serial.print(intervalRed);
          Serial.print(", ");
          Serial.print(intervalYellow);
          Serial.print(", ");
          Serial.println(intervalGreen);
        } else {
          Serial.println("Invalid intervals provided.");
        }
      } else {
        Serial.println("Invalid input format. Use: 2000,500,2000");
      }
    }
  }
}
```
### (확장 코드)
```cpp
// -------------------------
// (확장) 시리얼 입력 태스크: LED 유지시간 + 모드 변경(옵션)
// -------------------------
/**
 * @brief 시리얼로부터 입력받은 문자열을 파싱하여 LED 유지시간(세 필드)과 모드 변경(옵션)을 갱신한다.
 *
 * 입력 형식: "2000,500,2000,PCINT2"
 * 모드 필드는 변경이 필요할 때만 값을 포함하며, 빈 문자열일 경우 유지시간만 업데이트한다.
 */
void serialInputTaskCallback() {
  if (Serial.available()) {
    String input = Serial.readStringUntil('\n');
    input.trim();
    if (input.length() == 0) { return; }

    int comma1 = input.indexOf(',');
    int comma2 = (comma1 == -1) ? -1 : input.indexOf(',', comma1 + 1);
    int comma3 = (comma2 == -1) ? -1 : input.indexOf(',', comma2 + 1);

    // 쉼 표 3개가 없으면 그냥 무시하거나 에러 메시지
    if (comma1 == -1 || comma2 == -1 || comma3 == -1) {
      Serial.println("Invalid format: must have 3 commas, e.g. 2000,500,2000,");
      return;
    }

    String token1 = input.substring(0, comma1);             // 예: "2000"
    String token2 = input.substring(comma1 + 1, comma2);    // 예: "500"
    String token3 = input.substring(comma2 + 1, comma3);    // 예: "2000"
    String token4 = input.substring(comma3 + 1);            // 예: "" or "PCINT2"
    token4.trim();

    // 듀레이션 파싱
    unsigned int newRed    = token1.toInt();
    unsigned int newYellow = token2.toInt();
    unsigned int newGreen  = token3.toInt();

    if (newRed > 0 && newYellow > 0 && newGreen > 0) {
      intervalRed    = newRed;
      intervalYellow = newYellow;
      intervalGreen  = newGreen;
      Serial.print("Intervals updated to: ");
      Serial.print(intervalRed);
      Serial.print(", ");
      Serial.print(intervalYellow);
      Serial.print(", ");
      Serial.println(intervalGreen);
    } else {
      Serial.println("Invalid intervals provided.");
      return;
    }

    // 모드 토큰이 비어 있지 않으면 모드 변경
    if (token4.length() > 0) {
      if (token4.equals("Default")) {
        mode1Active = false;
        mode2Active = false;
        mode3Active = false;
        stateStartTime = millis();  
        currentState = BLINK_RED;  
      }
      else if (token4.equals("PCINT1")) {
        mode1Active = true;
        mode2Active = false;
        mode3Active = false;
        ledPattern = PATTERN_RED;
      }
      else if (token4.equals("PCINT2")) {
        mode1Active = false;
        mode2Active = true;
        mode3Active = false;
        ledPattern = PATTERN_MODE2_TOGGLE;
      }
      else if (token4.equals("PCINT3")) {
        mode1Active = false;
        mode2Active = false;
        mode3Active = true;
        ledPattern = PATTERN_OFF;
      }
      else {
        Serial.println("Invalid mode provided.");
      }
    }
  }
}
```
## 두 코드의 차이점

### 1. 입력 형식
- **기존**: `"2000,500,2000"` 형태로 세 개의 정수(빨강·노랑·초록 유지시간)만 처리  
- **확장**: `"2000,500,2000,PCINT2"` 형태로 네 번째 필드(모드 토큰)까지 인식

### 2. 모드 변경 기능
- **기존**: 유지 시간(`intervalRed`, `intervalYellow`, `intervalGreen`)만 갱신  
- **확장**: 네 번째 토큰이 존재하면 `Default`, `PCINT1`, `PCINT2`, `PCINT3` 중 하나로 모드를 전환  
  - `mode1Active`, `mode2Active`, `mode3Active`를 설정하고, `ledPattern`도 적절히 바꿈

### 3. 에러 처리
- **기존**: 쉼표가 2개(총 3개의 값)가 없으면 에러 메시지  
- **확장**: 쉼표가 3개(총 4개의 값) 이상 있어야 하며, 모드 토큰이 없을 수도 있으므로(`token4`가 `""`), 빈 문자열이면 유지 시간만 변경

### 4. 기존 로직과의 호환성
- **기존** 입력 `"2000,500,2000,"` 처럼 뒤에 쉼표만 붙여도 유지 시간 갱신 가능(모드 변경 없음)  
- **새 기능**: `"2000,500,2000,PCINT2"`로 유지 시간과 모드 변경을 한꺼번에 처리

이처럼 `serialInputTaskCallback()` 함수에서 **네 번째 필드**를 해석해 모드를 전환할 수 있게 함으로써,  
버튼 인터럽트뿐 아니라 시리얼 입력을 통해서도 **긴급 모드**, **전체 LED 토글**, **LED 끔**, **기본 상태 머신** 등  
다양한 모드를 제어할 수 있게 되었습니다. 그 외 상태 머신, TaskScheduler, 버튼 인터럽트 로직은 기존과 동일하게 동작하므로,  
**주요 변경 사항**은 오직 시리얼 입력 태스크 부분에 집중된 점이 특징입니다.

---

# (기존) Arduino 신호등 제어 코드

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