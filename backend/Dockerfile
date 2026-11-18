# Use official lightweight Node.js 20 Alpine base image
FROM node:20-alpine

# Set working directory inside the container
WORKDIR /usr/src/app

# Copy package descriptors
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy source code
COPY . .

# Expose backend port
EXPOSE 5000

# Run Express server
CMD ["node", "server.js"]
