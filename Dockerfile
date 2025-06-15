# Use Node.js LTS image
FROM node

# Create app directory
WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Copy rest of the app
COPY . .

# Expose port
EXPOSE 8000

# Start bot
CMD ["node", "bot.js"]
