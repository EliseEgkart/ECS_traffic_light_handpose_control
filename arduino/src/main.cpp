#include <Arduino.h>
#include <TaskScheduler.h>
#include <PinChangeInterrupt.h>

// -------------------------
// 핀 정의 및 매크로 상수 설정
// -------------------------

// LED 핀 정의 (PWM 제어가 가능한 핀 할당)
// 각 LED는 다른 색상(Red, Yellow, Green)을 나타냄
#define LED_RED       11  // 빨간 LED: PWM 가능 핀
#define LED_YELLOW    10  // 노란 LED: PWM 가능 핀
#define LED_GREEN     9   // 초록 LED: PWM 가능 핀

// 버튼 핀 정의 (내부 풀업 저항 사용)
// 각 버튼은 모드를 전환하기 위한 입력 역할
#define BUTTON1       4   // 모드1 전환용 버튼
#define BUTTON2       3   // 모드2 전환용 버튼
#define BUTTON3       2   // 모드3 전환용 버튼

// 가변저항 핀 정의: LED 밝기 조절에 사용
#define POTENTIOMETER A5

// -------------------------
// 태스크 주기 정의 (밀리초 단위)
// -------------------------

// 시리얼 입력 태스크: 시리얼 모니터로부터 입력을 받는 주기
#define RX_DURATION   500

// 시리얼 출력 태스크: LED 상태 및 모드 정보를 시리얼 모니터에 출력하는 주기
#define TX_DURATION   100

// 상태 머신 업데이트 태스크: 신호등 상태를 업데이트하는 주기
#define TASK_UPDATE_DURATION 10

// TaskScheduler 라이브러리를 위한 스케줄러 인스턴스 생성
Scheduler runner;

// -------------------------
// LED 패턴 상태를 나타내는 열거형
// -------------------------

enum LEDPatternState {
  PATTERN_OFF = 0,        // 모든 LED OFF 상태
  PATTERN_RED = 1,        // 빨간 LED ON 상태
  PATTERN_YELLOW = 2,     // 노란 LED ON 상태
  PATTERN_GREEN = 3,      // 초록 LED ON 상태
  PATTERN_MODE2_TOGGLE = 9 // 모드2에서 전체 LED 토글 시 사용
};
// 전역 변수: 현재 LED 패턴 상태 저장 (volatile 키워드는 인터럽트에 안전하도록 사용)
volatile LEDPatternState ledPattern = PATTERN_OFF;

// -------------------------
// 신호등 상태 머신 열거형
// -------------------------

enum TrafficLight_State {
  BLINK_RED,     // 빨간 LED 점멸 상태
  BLINK_YELLOW1, // 노란 LED 점멸 상태 (첫번째 단계)
  BLINK_GREEN,   // 초록 LED 점멸 상태
  FLICK_GREEN,   // 초록 LED 깜빡임(깜빡임 효과를 위한 ON/OFF 전환)
  BLINK_YELLOW2  // 노란 LED 점멸 상태 (두번째 단계)
};
// 전역 변수: 현재 신호등 상태 머신의 상태 저장
volatile TrafficLight_State currentState = BLINK_RED;

// -------------------------
// 각 상태별 유지 시간 (밀리초 단위)
// -------------------------

// BLINK_RED 상태에서 빨간 LED가 유지되는 시간 (예: 2000ms)
unsigned int intervalRed    = 2000;

// BLINK_YELLOW 상태에서 노란 LED가 유지되는 시간 (예: 500ms)
unsigned int intervalYellow = 500;

// BLINK_GREEN 상태에서 초록 LED가 유지되는 시간 (예: 2000ms)
unsigned int intervalGreen  = 2000;

// FLICK_GREEN 상태: 깜빡임 효과를 위해 1초 동안 3번 깜빡이도록 계산된 간격 (약 142ms)
unsigned int intervalFlick  = 1000 / 7; // OFF, ON, OFF, ON, OFF, ON, OFF

// -------------------------
// 상태 전이 및 깜빡임 제어 변수
// -------------------------

// 현재 상태 전환이 시작된 시간 저장 (millis() 기준)
unsigned long stateStartTime = 0;

// FLICK_GREEN 상태에서 몇 번 깜빡였는지 저장하는 변수
int flickCount = 0;

// -------------------------
// 모드 전환 플래그 (각 모드 중 하나만 활성화되도록 함)
// -------------------------

volatile bool mode1Active = false;  // 모드1: 빨간 LED 고정
volatile bool mode2Active = false;  // 모드2: 전체 LED 토글
volatile bool mode3Active = false;  // 모드3: 모든 LED 끄기

// -------------------------
// LED 밝기 제어 변수 (0~255 범위)
// -------------------------
volatile int brightness = 255;

// -------------------------
// 헬퍼 함수: LED에 PWM 값을 동시에 적용
// -------------------------
/**
 * @brief 지정된 PWM 값을 각 LED에 동시에 적용한다.
 *
 * @param r_val 빨간 LED의 PWM 값 (0~255)
 * @param y_val 노란 LED의 PWM 값 (0~255)
 * @param g_val 초록 LED의 PWM 값 (0~255)
 */
void analogWriteRYG(int r_val, int y_val, int g_val) {
  analogWrite(LED_RED, r_val);
  analogWrite(LED_YELLOW, y_val);
  analogWrite(LED_GREEN, g_val);
}

// -------------------------
// LED 렌더링 함수 (기본 모드)
// -------------------------
/**
 * @brief 현재 ledPattern과 brightness 변수에 따라 LED에 출력값을 설정한다.
 *
 * 각 패턴에 따라 해당하는 LED만 PWM 값을 적용하며, 나머지는 0으로 OFF 처리한다.
 */
void renderLED() {
  switch (ledPattern) {
    case PATTERN_RED:
      analogWriteRYG(brightness, 0, 0);
      break;
    case PATTERN_YELLOW:
      analogWriteRYG(0, brightness, 0);
      break;
    case PATTERN_GREEN:
      analogWriteRYG(0, 0, brightness);
      break;
    default: // PATTERN_OFF 또는 예외 케이스
      analogWriteRYG(0, 0, 0);
      break;
  }
}

// -------------------------
// 모드2 전용 LED 렌더링 함수: 전체 LED 토글 기능
// -------------------------
/**
 * @brief 모드2가 활성화 되었을 때, 500ms 간격으로 전체 LED를 ON/OFF 토글한다.
 *
 * 내부의 정적 변수(prevTime)를 사용해 마지막 토글 시간을 기억하며, 500ms마다 토글 상태를 변경한다.
 */
void renderMode2() {
  // 정적 변수: 함수 호출 간에도 값을 유지
  static unsigned long prevTime = millis();
  unsigned long now = millis();

  // 500ms 경과 시 토글
  if (now - prevTime >= 500) {
    prevTime = now;
    // 현재 ledPattern이 PATTERN_MODE2_TOGGLE이면 OFF, 그렇지 않으면 PATTERN_MODE2_TOGGLE로 전환
    ledPattern = (ledPattern == PATTERN_MODE2_TOGGLE) ? PATTERN_OFF : PATTERN_MODE2_TOGGLE;
  }

  // 토글 상태에 따라 모든 LED를 켜거나 끔
  if (ledPattern == PATTERN_MODE2_TOGGLE) {
    analogWriteRYG(brightness, brightness, brightness);
  } else {
    analogWriteRYG(0, 0, 0);
  }
}

// -------------------------
// 상태 머신 로직 업데이트 함수
// -------------------------
/**
 * @brief 신호등 상태 머신을 업데이트하여 LED 패턴을 결정한다.
 *
 * 모드1, 모드2, 모드3이 활성화되어 있으면 상태 머신을 동작시키지 않고,
 * 기본 동작이 아니라 각 모드에서 별도로 LED 제어를 진행한다.
 *
 * 각 상태에 따라 유지 시간을 확인한 후, 다음 상태로 전환하거나 깜빡임 효과를 적용한다.
 */
void updateStateMachine() {
  // 모드 전환이 활성화된 경우 상태 머신 동작 중단
  if (mode1Active || mode2Active || mode3Active) return;

  unsigned long now = millis();

  // 상태에 따른 동작 처리
  switch (currentState) {
    case BLINK_RED:
      // 빨간 LED 점멸 상태: PATTERN_RED 적용
      ledPattern = PATTERN_RED;
      if (now - stateStartTime >= intervalRed) {
        // 유지 시간이 지나면 다음 상태로 전환
        stateStartTime = now;
        currentState = BLINK_YELLOW1;
      }
      break;

    case BLINK_YELLOW1:
      // 첫 번째 노란 LED 점멸 상태: PATTERN_YELLOW 적용
      ledPattern = PATTERN_YELLOW;
      if (now - stateStartTime >= intervalYellow) {
        stateStartTime = now;
        currentState = BLINK_GREEN;
      }
      break;

    case BLINK_GREEN:
      // 초록 LED 점멸 상태: PATTERN_GREEN 적용
      ledPattern = PATTERN_GREEN;
      if (now - stateStartTime >= intervalGreen) {
        stateStartTime = now;
        // 깜빡임 효과를 위해 FLICK_GREEN 상태로 전환하고, 깜빡임 카운터 초기화
        currentState = FLICK_GREEN;
        flickCount = 0;
      }
      break;

    case FLICK_GREEN:
      // 초록 LED 깜빡임 상태: 정해진 간격마다 ON/OFF 전환
      if (now - stateStartTime >= intervalFlick) {
        stateStartTime = now;
        // 현재 상태에 따라 LED를 ON 또는 OFF로 전환
        ledPattern = (ledPattern == PATTERN_GREEN) ? PATTERN_OFF : PATTERN_GREEN;
        flickCount++;
        // 6번 깜빡임(ON/OFF 전환)을 완료하면 다음 상태로 전환
        if (flickCount >= 7) {
          currentState = BLINK_YELLOW2;
          stateStartTime = now;
        }
      }
      break;

    case BLINK_YELLOW2:
      // 두 번째 노란 LED 점멸 상태: PATTERN_YELLOW 적용
      ledPattern = PATTERN_YELLOW;
      if (now - stateStartTime >= intervalYellow) {
        stateStartTime = now;
        // 다시 초기 상태인 BLINK_RED로 전환하여 반복
        currentState = BLINK_RED;
      }
      break;
  }
}

// 상태 머신 업데이트 태스크 생성: TASK_UPDATE_DURATION 간격마다 updateStateMachine() 호출
Task taskStateMachine(TASK_UPDATE_DURATION, TASK_FOREVER, []() {updateStateMachine();});

// -------------------------
// 시리얼 모니터 출력 태스크: LED 밝기와 모드 상태, LED ON/OFF 상태 출력
// -------------------------
/**
 * @brief 시리얼 모니터에 현재 LED 밝기, 활성화된 모드, 그리고 각 LED의 ON/OFF 상태를 출력한다.
 *
 * LED 상태는 ledPattern 값에 따라 단순 이진 값(ON=1, OFF=0)으로 출력된다.
 */
void serialMonitorTaskCallback() {
  // 현재 밝기를 'B:' 뒤에 출력
  Serial.print("B:");
  Serial.print(brightness);

  // 현재 활성화된 모드를 'M:' 뒤에 출력
  Serial.print(" M:");
  if (mode1Active) {
    Serial.print("PCINT1");
  } else if (mode2Active) {
    Serial.print("PCINT2");
  } else if (mode3Active) {
    Serial.print("PCINT3");
  } else {
    Serial.print("Default");
  }

  // LED 상태를 결정: 각 LED에 대해 0 또는 1 값을 결정 (1이면 LED가 켜진 상태)
  int rState = 0, yState = 0, gState = 0;
  switch (ledPattern) {
    case PATTERN_RED:
      rState = 1;
      break;
    case PATTERN_YELLOW:
      yState = 1;
      break;
    case PATTERN_GREEN:
      gState = 1;
      break;
    case PATTERN_MODE2_TOGGLE:
      // 모드2에서는 전체 LED 토글 동작 중이므로 모든 LED가 ON 상태로 간주
      rState = 1;
      yState = 1;
      gState = 1;
      break;
    default:
      // PATTERN_OFF 또는 기타 예외 케이스: 모든 LED OFF
      break;
  }
  // LED 상태를 'O:' 뒤에 "r,y,g" 형식으로 출력
  Serial.print(" O:");
  Serial.print(rState);
  Serial.print(",");
  Serial.print(yState);
  Serial.print(",");
  Serial.println(gState);
}

// 시리얼 출력 태스크 생성: TX_DURATION 간격마다 serialMonitorTaskCallback() 호출
Task taskSerialOutput(TX_DURATION, TASK_FOREVER, &serialMonitorTaskCallback);

// -------------------------
// 시리얼 입력 태스크: 외부에서 LED 유지시간을 업데이트하기 위한 입력 처리
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
      // 첫 번째와 두 번째 쉼표 위치를 찾아서 세 값으로 분리
      int firstComma = input.indexOf(',');
      int secondComma = input.indexOf(',', firstComma + 1);
      if (firstComma != -1 && secondComma != -1) {
        // 쉼표를 기준으로 각 부분을 정수로 변환
        unsigned int newRed = input.substring(0, firstComma).toInt();
        unsigned int newYellow = input.substring(firstComma + 1, secondComma).toInt();
        unsigned int newGreen = input.substring(secondComma + 1).toInt();
        // 새로 입력받은 값들이 유효한 양수이면 각 유지시간을 갱신
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

// 시리얼 입력 태스크 생성: RX_DURATION 간격마다 serialInputTaskCallback() 호출
Task taskSerialInput(RX_DURATION, TASK_FOREVER, &serialInputTaskCallback);

// -------------------------
// 버튼 인터럽트 콜백 함수들: 각 버튼 누름에 따라 모드 전환 처리
// -------------------------

/**
 * @brief 버튼1 인터럽트 콜백 함수
 *
 * 모드1 토글: 버튼1이 눌리면 모드1 활성화 (빨간 LED 고정). 다시 누르면 모드1 비활성화하고 상태 머신으로 복귀.
 */
void PCINTCallbackButton1() {
  static bool lastState = HIGH;  // 이전 버튼 상태를 저장
  bool currentStateBtn = digitalRead(BUTTON1);  // 현재 버튼 상태 읽기

  // 버튼이 HIGH에서 LOW로 전환되었을 때(버튼 누름 감지)
  if (lastState == HIGH && currentStateBtn == LOW) {
    if (!mode1Active) {
      // 모드1을 활성화하고 다른 모드는 비활성화
      mode1Active = true;
      mode2Active = false;
      mode3Active = false;
      // 모드1에서는 상태 머신 동작 대신 빨간 LED를 지속적으로 표시
      ledPattern = PATTERN_RED;
    } else {
      // 모드1이 이미 활성화되어 있으면 비활성화 후 상태 머신 복귀
      mode1Active = false;
      stateStartTime = millis();  // 상태 전환 시간 초기화
      currentState = BLINK_RED;   // 초기 상태로 복귀
    }
  }
  // 마지막 버튼 상태 업데이트
  lastState = currentStateBtn;
}

/**
 * @brief 버튼2 인터럽트 콜백 함수
 *
 * 모드2 토글: 버튼2가 눌리면 모드2 활성화 (전체 LED 500ms 간격 토글). 다시 누르면 모드2 비활성화하고 상태 머신 복귀.
 */
void PCINTCallbackButton2() {
  static bool lastState = HIGH;
  bool currentStateBtn = digitalRead(BUTTON2);

  if (lastState == HIGH && currentStateBtn == LOW) {
    if (!mode2Active) {
      mode2Active = true;
      mode1Active = false;
      mode3Active = false;
      // 모드2에서는 상태 머신 대신 토글 패턴 적용
      ledPattern = PATTERN_MODE2_TOGGLE;
    } else {
      mode2Active = false;
      stateStartTime = millis();
      currentState = BLINK_RED;
    }
  }
  lastState = currentStateBtn;
}

/**
 * @brief 버튼3 인터럽트 콜백 함수
 *
 * 모드3 토글: 버튼3이 눌리면 모드3 활성화 (모든 LED를 끔). 다시 누르면 모드3 비활성화하고 상태 머신 복귀.
 */
void PCINTCallbackButton3() {
  static bool lastState = HIGH;
  bool currentStateBtn = digitalRead(BUTTON3);

  if (lastState == HIGH && currentStateBtn == LOW) {
    if (!mode3Active) {
      mode3Active = true;
      mode1Active = false;
      mode2Active = false;
      // 모드3에서는 상태 머신 대신 모든 LED를 끔
      ledPattern = PATTERN_OFF;
    } else {
      mode3Active = false;
      stateStartTime = millis();
      currentState = BLINK_RED;
    }
  }
  lastState = currentStateBtn;
}

// -------------------------
// Setup 함수: 초기 설정 및 태스크, 인터럽트 설정
// -------------------------
void setup() {
  // 시리얼 통신 초기화 (보오율: 9600)
  Serial.begin(9600);

  // LED 핀을 출력 모드로 설정
  pinMode(LED_RED, OUTPUT);
  pinMode(LED_YELLOW, OUTPUT);
  pinMode(LED_GREEN, OUTPUT);

  // 버튼 핀을 내부 풀업(PULLUP) 모드로 설정 (버튼 누름 시 LOW 신호)
  pinMode(BUTTON1, INPUT_PULLUP);
  pinMode(BUTTON2, INPUT_PULLUP);
  pinMode(BUTTON3, INPUT_PULLUP);

  // 각 버튼에 대해 핀 체인지 인터럽트를 설정하여 버튼 상태 변화 감지
  attachPCINT(digitalPinToPCINT(BUTTON1), PCINTCallbackButton1, CHANGE);
  attachPCINT(digitalPinToPCINT(BUTTON2), PCINTCallbackButton2, CHANGE);
  attachPCINT(digitalPinToPCINT(BUTTON3), PCINTCallbackButton3, CHANGE);

  // TaskScheduler 초기화 및 태스크 등록
  runner.init();
  runner.addTask(taskStateMachine);
  runner.addTask(taskSerialOutput);
  runner.addTask(taskSerialInput);

  // 등록한 태스크들을 활성화
  taskStateMachine.enable();
  taskSerialOutput.enable();
  taskSerialInput.enable();

  // 상태 머신 초기 상태 설정: 현재 시간 기준으로 시작 시간 초기화
  stateStartTime = millis();
}

// -------------------------
// Loop 함수: 메인 루프, 반복 실행
// -------------------------
void loop() {
  // 매 반복마다 가변저항(POTENTIOMETER) 값을 읽어 LED 밝기 업데이트
  int potVal = analogRead(POTENTIOMETER);
  brightness = map(potVal, 0, 1023, 0, 255);

  // 모드2가 활성화되어 있으면 모드2 전용 렌더링 함수 호출, 그렇지 않으면 기본 LED 렌더링
  if (mode2Active) {
    renderMode2();
  } else {
    renderLED();
  }

  // TaskScheduler를 통해 등록된 태스크들을 실행
  runner.execute();
}
