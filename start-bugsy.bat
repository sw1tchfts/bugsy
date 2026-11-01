@echo off
setlocal EnableExtensions EnableDelayedExpansion
title Bugsy
cd /d "%~dp0"

echo.
echo  Starting Bugsy...
echo.

rem --- What the app needs on this computer --------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Install the LTS version from https://nodejs.org and run this again.
  goto :fail
)
where docker >nul 2>nul
if errorlevel 1 (
  echo  Docker Desktop is not installed. Install it from https://www.docker.com/products/docker-desktop and run this again.
  goto :fail
)
docker info >nul 2>nul
if errorlevel 1 (
  echo  Docker Desktop is not running. Start it, wait until it says it is running, and run this again.
  goto :fail
)

rem --- Packages (first run, or after an update) ----------------------------
if not exist "node_modules\" (
  echo  Installing packages. The first time takes a few minutes...
  call npm install
  if errorlevel 1 goto :fail
)

rem --- The local database and sign-in server -------------------------------
echo  Starting the local database...
call npx supabase start
if errorlevel 1 (
  echo  The local database did not start. Check that Docker Desktop is running.
  goto :fail
)

rem --- Settings file, filled from the running database (first run) ---------
if not exist ".env.local" (
  echo  Writing .env.local...
  set "ANON="
  set "SERVICE="
  for /f "usebackq tokens=1,* delims==" %%A in (`npx supabase status -o env 2^>nul`) do (
    if /i "%%A"=="ANON_KEY" set "ANON=%%~B"
    if /i "%%A"=="SERVICE_ROLE_KEY" set "SERVICE=%%~B"
  )
  if not defined ANON (
    echo  Could not read the database keys. Run "npx supabase status" and paste them into .env.local by hand.
    goto :fail
  )
  > ".env.local" (
    echo DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres
    echo NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
    echo NEXT_PUBLIC_SUPABASE_ANON_KEY=!ANON!
    echo SUPABASE_SERVICE_ROLE_KEY=!SERVICE!
    echo APP_URL=http://localhost:3000
  )
)

rem --- Demo data, loaded once (delete .bugsy-seeded to start over) ---------
if not exist ".bugsy-seeded" (
  echo  Building the database and loading the demo companies...
  call npx supabase db reset
  if errorlevel 1 goto :fail
  call npm run seed
  if errorlevel 1 goto :fail
  echo seeded> ".bugsy-seeded"
)

echo.
echo  Bugsy is starting at http://localhost:3000
echo  Sign in as owner@northwind.test with the password bugsy-dev-password
echo  (technician@, office@, dispatcher@, bookkeeper@ ... northwind.test work too).
echo  Close this window, or press Ctrl+C, to stop the app.
echo.

rem Open the browser once the server has had a moment to start.
start "" cmd /c "timeout /t 12 /nobreak >nul & start http://localhost:3000"
call npm run dev
goto :eof

:fail
echo.
pause
exit /b 1
