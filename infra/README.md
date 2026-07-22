# infra — Docker Compose 스택 (nginx + pgapi + Postgres + Redis + LiveKit)

```
인터넷 → nginx(80/443, TLS·rate limit) ─┬→ api(Express) ─┬→ db(Postgres 16)
                                        │                └→ redis(캐시·presence)
                                        └→ livekit(host 네트워크, wss 프록시 / RTC는 UDP 직결)
```

- **Redis 용도 (딱 2곳)**: ① `presence:<memberId>` TTL 90초 — 실시간 접속 상태(만료 = 자동 오프라인), ② `board:<code>:<week>` TTL 30초 — 리더보드 캐시. `REDIS_URL` 미설정·장애 시 기존 DB·메모리 경로로 자동 폴백.
- **nginx 용도**: TLS 종료(sslip.io + Let's Encrypt), `/api` 프록시, WebSocket 업그레이드(`/ws`, livekit), 인증 엔드포인트 `limit_req`(분당 10회) 게이트웨이 방어선.
- **오버엔지니어링 배제**: 오케스트레이션(k8s)·메시지큐·모니터링 스택 없음. VM 1대 + compose가 스코프.

## 로컬 스모크 (Mac)

```bash
cd infra
cp .env.example .env                     # 로컬은 자리표시자면 충분 (livekit 프로필 제외라 키 불필요)
docker compose up -d --build db redis api
curl -s localhost:8080/api/health        # {"ok":true}
docker compose logs api | grep redis     # "redis connected"
# nginx까지 보려면(자가서명): README 하단 '로컬 nginx 검증' 참고
docker compose down                      # 데이터까지 지우려면 -v
```

## VM 마이그레이션 순서 (pg-api-vm, Debian 12)

> 전 과정 `gcloud compute ssh pg-api-vm --zone asia-northeast3-a` 안에서. **1번(백업)을 건너뛰지 말 것.**

1. **백업 (필수)**: `sudo -u postgres pg_dump pg > ~/pg-backup-$(date +%F).sql` + 로컬로 `gcloud compute scp` 사본.
2. **Docker 설치**: `sudo apt-get update && sudo apt-get install -y docker.io docker-compose-v2 && sudo usermod -aG docker $USER` (재로그인).
3. **코드 가져오기**: 저장소의 `infra/` + `backend-vm/`을 VM에 rsync/scp.
4. **.env 생성 (VM 위에서, 값은 화면에 출력하지 않기)**: 기존 시크릿 위치 —
   - `/etc/systemd/system/pgapi.service`(및 드롭인 `livekit-self.conf`)의 `Environment=` 줄들 → LIVEKIT_*, GOOGLE_CLIENT_ID, 기존 DATABASE_URL의 비밀번호 → POSTGRES_PASSWORD.
   - `sudo grep -h Environment /etc/systemd/system/pgapi.service /etc/systemd/system/pgapi.service.d/*.conf | sed 's/Environment=//' >> infra/.env` 후 편집기로 정리.
5. **기존 서비스 정지 (삭제 아님 — 롤백 대비)**: `sudo systemctl disable --now pgapi livekit caddy` (postgres는 데이터 복원 후에 정지).
6. **인증서 발급 (nginx 시작 전, 80 포트 비어있을 때)**:
   ```bash
   docker compose --profile certs run --rm -p 80:80 certbot certonly --standalone \
     -d 34-64-158-222.sslip.io -d lk.34-64-158-222.sslip.io \
     --email <이메일> --agree-tos --no-eff-email
   ```
7. **스택 기동**: `docker compose --profile vm up -d --build`
8. **데이터 복원**: `docker compose exec -T db psql -U pg pg < ~/pg-backup-*.sql` 후 `sudo systemctl disable --now postgresql`.
9. **검증**:
   - `curl -s https://34-64-158-222.sslip.io/api/health` → `{"ok":true}`
   - `docker compose exec redis redis-cli keys 'presence:*'` (프론트 접속 후 키 생성 확인)
   - 리더보드 응답 + `board:*` 키 TTL 확인, `?lkself=1`로 livekit JoinResponse.
10. **인증서 갱신 (월 1회 cron)**: `docker compose --profile certs run --rm certbot renew --webroot -w /var/www/certbot && docker compose exec nginx nginx -s reload`

**롤백**: `docker compose down` → `sudo systemctl enable --now postgresql pgapi livekit caddy` (기존 데이터·설정 그대로 남아있음).

## 로컬 nginx 검증 (자가서명 인증서)

```bash
docker compose run --rm --entrypoint sh certbot -c \
  "mkdir -p /etc/letsencrypt/live/34-64-158-222.sslip.io && cd /etc/letsencrypt/live/34-64-158-222.sslip.io && \
   apk add --no-cache openssl >/dev/null 2>&1 || true; \
   openssl req -x509 -newkey rsa:2048 -nodes -days 3 -subj /CN=34-64-158-222.sslip.io \
     -keyout privkey.pem -out fullchain.pem"
docker compose up -d nginx
curl -sk https://localhost/api/health -H 'Host: 34-64-158-222.sslip.io'   # {"ok":true}
```
