# ===========================================
# Initialize Mirthless Database (Windows)
# ===========================================
# Creates the mirthless database and user on a local PostgreSQL instance.
# Safe to run multiple times — uses IF NOT EXISTS / ON CONFLICT.
#
# Prerequisites:
#   - PostgreSQL installed and running locally
#   - psql available on PATH (typically C:\Program Files\PostgreSQL\<version>\bin)
#
# Usage:
#   .\scripts\init-db.ps1                                    # defaults
#   .\scripts\init-db.ps1 -PgUser admin -PgPort 5433        # override
#
# Parameters (all optional):

param(
    [string]$PgHost     = "localhost",
    [string]$PgPort     = "5432",
    [string]$PgUser     = "postgres",
    [string]$PgPassword = "postgres",
    [string]$DbName     = "mirthless",
    [string]$DbUser     = "mirthless",
    [string]$DbPassword = "mirthless_dev"
)

$ErrorActionPreference = "Stop"
$env:PGPASSWORD = $PgPassword

Write-Host "=== Mirthless Database Setup ===" -ForegroundColor Cyan
Write-Host "  Host:     ${PgHost}:${PgPort}"
Write-Host "  Admin:    ${PgUser}"
Write-Host "  Database: ${DbName}"
Write-Host "  App user: ${DbUser}"
Write-Host ""

# Find psql
$psql = Get-Command psql -ErrorAction SilentlyContinue
if (-not $psql) {
    # Check common install paths
    $paths = @(
        "C:\Program Files\PostgreSQL\18\bin\psql.exe",
        "C:\Program Files\PostgreSQL\17\bin\psql.exe",
        "C:\Program Files\PostgreSQL\16\bin\psql.exe",
        "C:\Program Files\PostgreSQL\15\bin\psql.exe"
    )
    foreach ($p in $paths) {
        if (Test-Path $p) {
            $psql = $p
            break
        }
    }
    if (-not $psql) {
        Write-Host "ERROR: psql not found. Install PostgreSQL or add its bin directory to PATH." -ForegroundColor Red
        Write-Host "  Typical location: C:\Program Files\PostgreSQL\<version>\bin"
        exit 1
    }
}
$psqlCmd = if ($psql -is [System.Management.Automation.ApplicationInfo]) { $psql.Source } else { $psql }

# Helper to run psql
function Invoke-Psql {
    param([string]$Sql, [switch]$Tuples)
    $args_ = @("-h", $PgHost, "-p", $PgPort, "-U", $PgUser)
    if ($Tuples) { $args_ += "-t" }
    $args_ += @("-c", $Sql)
    & $psqlCmd @args_ 2>&1
}

# Check connection
Write-Host "Checking connection..." -NoNewline
try {
    $result = Invoke-Psql "SELECT 1"
    if ($LASTEXITCODE -ne 0) { throw "Connection failed" }
    Write-Host " OK" -ForegroundColor Green
} catch {
    Write-Host " FAILED" -ForegroundColor Red
    Write-Host ""
    Write-Host "ERROR: Cannot connect to PostgreSQL at ${PgHost}:${PgPort} as ${PgUser}." -ForegroundColor Red
    Write-Host "  - Is PostgreSQL running? Check Services (services.msc)"
    Write-Host "  - Wrong password? Use: .\scripts\init-db.ps1 -PgPassword <password>"
    exit 1
}

# Create user
Write-Host "1. Creating user '${DbUser}'..." -NoNewline
$exists = Invoke-Psql "SELECT 1 FROM pg_roles WHERE rolname='${DbUser}'" -Tuples
if ($exists -match "1") {
    Write-Host " already exists." -ForegroundColor Yellow
} else {
    Invoke-Psql "CREATE USER ${DbUser} WITH PASSWORD '${DbPassword}';" | Out-Null
    Write-Host " created." -ForegroundColor Green
}

# Create database
Write-Host "2. Creating database '${DbName}'..." -NoNewline
$exists = Invoke-Psql "SELECT 1 FROM pg_database WHERE datname='${DbName}'" -Tuples
if ($exists -match "1") {
    Write-Host " already exists." -ForegroundColor Yellow
} else {
    Invoke-Psql "CREATE DATABASE ${DbName} OWNER ${DbUser};" | Out-Null
    Write-Host " created." -ForegroundColor Green
}

# Grant privileges
Write-Host "3. Granting privileges..." -NoNewline
Invoke-Psql "GRANT ALL PRIVILEGES ON DATABASE ${DbName} TO ${DbUser};" | Out-Null
Write-Host " done." -ForegroundColor Green

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Connection string:" -ForegroundColor White
Write-Host "  DATABASE_URL=postgresql://${DbUser}:${DbPassword}@${PgHost}:${PgPort}/${DbName}"
Write-Host ""
Write-Host "Next steps:" -ForegroundColor White
Write-Host "  1. Update DATABASE_URL in .env if needed"
Write-Host "  2. pnpm db:migrate    # apply schema migrations"
Write-Host "  3. pnpm db:seed       # seed admin user + defaults"
Write-Host "  4. pnpm dev           # start the server"

# Cleanup
Remove-Item Env:\PGPASSWORD -ErrorAction SilentlyContinue
