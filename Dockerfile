FROM node:18-alpine AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run build

FROM python:3.10-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HERMES_SESSIONS_DIR=/root/.hermes/sessions \
    PIXEL_UI_DISABLE_CAFFEINATE=1

WORKDIR /app

COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY backend/ ./backend/

WORKDIR /app/backend
EXPOSE 9000

CMD ["python", "server.py"]
