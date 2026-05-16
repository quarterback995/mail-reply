# 第一步：构建
FROM node:20-alpine AS build

WORKDIR /app

# 使用淘宝镜像加速 npm
RUN npm config set registry https://registry.npmmirror.com

# 安装依赖
COPY package*.json ./
RUN npm install && npm cache clean --force

# 复制源码并构建
COPY . .
RUN npm run build

# 第二步：运行
FROM nginx:alpine

# 复制构建产物
COPY --from=build /app/dist /usr/share/nginx/html

# 复制 nginx 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
