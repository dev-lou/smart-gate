@echo off
REM ============================================================
REM  Smart Gate Brain API Launcher
REM  Uses face_env virtualenv with dlib + face_recognition
REM ============================================================

echo.
echo  Smart Gate Brain API
echo  ====================
echo.

REM Activate the face_env virtualenv
call "%~dp0face_env\Scripts\activate.bat"

REM Verify dlib is available
python -c "import dlib; import face_recognition; print('  [OK] dlib', dlib.__version__, '+ face_recognition loaded')" 2>nul
if errorlevel 1 (
    echo  [WARN] dlib/face_recognition not available - falling back to LBPH
    echo         Run: pip install -r raspberry-pi\requirements.txt
    echo.
)

REM Start the Brain API
echo  Starting Brain API on http://0.0.0.0:8088 ...
echo.
cd /d "%~dp0raspberry-pi"
python brain_api.py
