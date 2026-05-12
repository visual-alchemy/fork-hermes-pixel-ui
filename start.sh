#!/bin/bash

# Hermes Pixel UI - Startup Script
# Inicia backend y frontend simultáneamente

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🎮 Hermes Pixel UI - Iniciando..."
echo ""

# Verificar dependencias
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 no encontrado"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "❌ Error: npm no encontrado"
    exit 1
fi

# Iniciar backend en background
echo "🚀 Iniciando backend (puerto 9000)..."
echo "☕ El backend activará caffeinate automáticamente en macOS"
cd backend

if [ ! -d ".venv" ]; then
    echo "📦 Creando entorno virtual..."
    python3 -m venv .venv
fi

source .venv/bin/activate

if [ ! -f ".venv/bin/fastapi" ]; then
    echo "📦 Instalando dependencias de Python..."
    pip install -q -r requirements.txt
fi

python server.py &
BACKEND_PID=$!
cd ..

echo "✅ Backend iniciado (PID: $BACKEND_PID)"
echo ""

# Esperar a que el backend esté listo
sleep 2

# Iniciar frontend
echo "🎨 Iniciando frontend (puerto 9001)..."
cd frontend

if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias de Node (esto puede tardar)..."
    npm install
fi

npm run dev &
FRONTEND_PID=$!
cd ..

echo "✅ Frontend iniciado (PID: $FRONTEND_PID)"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🎮 Hermes Pixel UI está corriendo!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📱 Abre tu navegador en: http://localhost:9001"
echo "🔌 Backend API: http://localhost:9000"
echo "📚 API Docs: http://localhost:9000/docs"
echo ""
echo "Presiona Ctrl+C para detener todos los servicios"
echo ""

# Manejar shutdown
trap "echo ''; echo '👋 Deteniendo servicios...'; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM

# Mantener script corriendo
wait
