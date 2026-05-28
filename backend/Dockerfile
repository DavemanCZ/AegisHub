FROM golang:1.22-alpine AS builder

WORKDIR /app

COPY go.mod ./
COPY . .

RUN go get github.com/lib/pq github.com/golang-jwt/jwt/v5 golang.org/x/crypto@v0.17.0 github.com/google/uuid && go mod tidy
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o aegis-backend .

FROM alpine:latest  
RUN apk --no-cache add ca-certificates

WORKDIR /root/
COPY --from=builder /app/aegis-backend .

EXPOSE 8080

CMD ["./aegis-backend"]
