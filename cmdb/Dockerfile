ARG GOLANG_1_22_ALPINE_IMAGE=golang:1.22-alpine
ARG ALPINE_3_20_IMAGE=alpine:3.20
FROM ${GOLANG_1_22_ALPINE_IMAGE} AS builder
ARG GOPROXY=https://mirrors.aliyun.com/goproxy/,direct
ARG GOSUMDB=sum.golang.google.cn
ENV GOPROXY=${GOPROXY}
ENV GOSUMDB=${GOSUMDB}

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG TARGETOS
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH:-amd64} go build -o /bin/cmdb ./cmd/cmdb

FROM ${ALPINE_3_20_IMAGE}
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=builder /bin/cmdb /bin/cmdb
EXPOSE 8088
ENTRYPOINT ["/bin/cmdb"]
