@echo off
call "C:\Program Files\Microsoft Visual Studio\18\Community\VC\Auxiliary\Build\vcvars64.bat"
set "PATH=C:\Program Files\CMake\bin;%PATH%"
python -m pip install dlib face_recognition
