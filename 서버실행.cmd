@echo off
chcp 65001 >nul
setlocal EnableExtensions
title 기상청 중기예보 서버

rem 이 파일이 있는 폴더(프로젝트 루트)로 이동합니다. 한글·공백 경로도 따옴표로 처리합니다.
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%" 2>nul
if errorlevel 1 goto :no_project
if not exist "server.py" goto :no_server

rem ---- Python 3.10 이상 찾기: py -3 를 먼저, 없으면 python ----
set "PY_CMD="
set "PY_OLD="
py -3 -c "import sys" >nul 2>nul
if errorlevel 1 goto :try_python
py -3 -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if errorlevel 1 (set "PY_OLD=py -3") else (set "PY_CMD=py -3")
if defined PY_CMD goto :python_ok

:try_python
python -c "import sys" >nul 2>nul
if errorlevel 1 goto :python_missing
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3,10) else 1)" >nul 2>nul
if errorlevel 1 (set "PY_OLD=python") else (set "PY_CMD=python")
if defined PY_CMD goto :python_ok
goto :python_missing

:python_ok
for /f "delims=" %%v in ('%PY_CMD% -c "import sys; print(sys.version.split()[0])"') do set "PY_VER=%%v"
echo [확인] Python %PY_VER% 사용 (%PY_CMD%)

rem ---- 8080 포트 확인: 다른 프로그램은 종료하지 않고 안내만 합니다 ----
netstat -ano | findstr /R /C:":8080 .*LISTENING" >nul
if not errorlevel 1 goto :port_busy

rem ---- KEY.env 확인: 값은 화면에 출력하지 않습니다 ----
if exist "KEY.env" goto :key_exists
echo [안내] KEY.env가 없습니다. 인증키 설정 안내 화면은 그대로 실행됩니다.
echo        위치: "%CD%\KEY.env"
echo        내용: KMA_SERVICE_KEY=발급받은_실제_인증키
if exist "KEY.env.txt" echo [주의] KEY.env.txt 파일이 있습니다. 파일 이름을 KEY.env로 바꿔 주세요.
goto :start
:key_exists
findstr /B /C:"KMA_SERVICE_KEY=" "KEY.env" >nul 2>nul
if errorlevel 1 echo [안내] KEY.env에 KMA_SERVICE_KEY= 줄이 없습니다. 서버 화면의 안내를 확인하세요.
findstr /B /C:"GEMINI_API_KEY=" "KEY.env" >nul 2>nul
if errorlevel 1 echo [선택] AI 예보 도우미를 쓰려면 KEY.env에 GEMINI_API_KEY를 추가하세요.

:start
echo.
echo 서버를 시작하는 중입니다. 아래에 [준비 완료]가 표시된 뒤 접속하세요.
echo 기본 주소: http://127.0.0.1:8080/outlook
echo 이 창을 닫으면 서버가 꺼집니다. 종료하려면 Ctrl+C를 누르세요.
echo.
%PY_CMD% server.py
set "EXIT_CODE=%ERRORLEVEL%"
echo.
if not "%EXIT_CODE%"=="0" echo [오류] 서버가 종료되었습니다. 종료 코드 %EXIT_CODE%. 위 메시지를 확인하세요.
echo 창을 닫으려면 아무 키나 누르세요.
pause >nul
endlocal
exit /b %EXIT_CODE%

:no_project
echo [오류] 프로젝트 폴더로 이동할 수 없습니다: "%PROJECT_DIR%"
goto :fail

:no_server
echo [오류] server.py를 찾을 수 없습니다.
echo        찾은 위치: "%CD%\server.py"
echo        서버실행.cmd와 server.py를 같은 프로젝트 폴더에 두세요.
goto :fail

:python_missing
if defined PY_OLD goto :python_old
echo [오류] Python 3을 찾을 수 없습니다.
echo        https://www.python.org/downloads/ 에서 Python 3.10 이상을 설치하세요.
echo        설치 첫 화면에서 "Add python.exe to PATH"를 선택한 뒤, 이 창을 닫고 다시 실행하세요.
goto :fail

:python_old
for /f "delims=" %%v in ('%PY_OLD% -c "import sys; print(sys.version.split()[0])"') do set "PY_VER=%%v"
echo [오류] Python %PY_VER%이 설치되어 있지만 3.10 이상이 필요합니다.
echo        https://www.python.org/downloads/ 에서 최신 Python 3을 설치한 뒤 다시 실행하세요.
goto :fail

:port_busy
echo [오류] 8080 포트를 다른 프로그램이 이미 사용 중입니다.
echo        이미 이 서버가 다른 창에서 실행 중일 수 있습니다. 그 창을 확인하세요.
echo        다른 프로그램은 자동으로 종료하지 않습니다. 사용 중인 프로그램 확인: netstat -ano ^| findstr :8080
echo        다른 포트로 실행하려면 이 폴더에서: %PY_CMD% server.py --port 8081
goto :fail

:fail
echo.
echo 창을 닫으려면 아무 키나 누르세요.
pause >nul
endlocal
exit /b 1
