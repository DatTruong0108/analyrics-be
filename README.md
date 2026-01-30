# Analyrics Backend 🎵🤖

**Analyrics** is a powerful song analysis platform that uses Artificial Intelligence to interpret lyrics, providing insights into vibes, hidden meanings, and cultural context. This repository contains the **Backend API** built with **NestJS**.

## 🚀 Features

-   **AI-Powered Analysis**: Uses **Google Gemini 1.5 Flash** to analyze lyrics for vibe, metaphors, and core messages.
-   **Song Data**: Integrates with **Genius** (via `genius-lyrics` & `puppeteer`) to fetch accurate lyrics and metadata.
-   **Authentication**: Secure JWT-based authentication (Passport + Bcrypt) for user management.
-   **Database**: robust data persistence using **PostgreSQL** and **Prisma ORM**.
-   **Advanced Scraping**: Implements a stealthy headless browser solution (Puppeteer) to bypass anti-bot protections when fetching lyrics.

## 🛠️ Tech Stack

-   **Framework**: [NestJS](https://nestjs.com/) (Node.js/TypeScript)
-   **Database**: PostgreSQL
-   **ORM**: [Prisma](https://www.prisma.io/)
-   **AI**: Google Generative AI (Gemini)
-   **Scraping**: Puppeteer (Headless Chrome) + Stealth Plugin
-   **Authentication**: Passport, JWT

## ⚙️ Prerequisites

Before running the project, ensure you have:

*   [Node.js](https://nodejs.org/) (v18 or higher recommended)
*   [PostgreSQL](https://www.postgresql.org/) (running locally or via Docker)
*   Gemini API Key ([Get it here](https://aistudio.google.com/app/apikey))

## 📦 Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/DatTruong0108/analyrics-be.git
    cd analyrics-be
    ```

2.  **Install dependencies**
    *   Note: Puppeteer will install a local version of Chromium.
    ```bash
    npm install
    ```

3.  **Configure Environment**
    Create a `.env` file in the root directory (copy from `.env.example` if available) and fill in your keys:

    ```env
    # Server Configuration
    BE_PORT=3001
    
    # Database
    DATABASE_URL="postgresql://user:password@localhost:5432/analyrics_db?schema=public"
    
    # JWT Auth
    JWT_SECRET="your_super_secret_jwt_key"
    JWT_EXPIRES_IN="7d"
    
    # External APIs
    AI_API_KEY="your_google_gemini_api_key"
    SEARCH_API="api_url_to_search_songs"
    GET_LYRICS_API="api_url_to_get_lyrics"
    ```

4.  **Setup Database**
    Run migrations to create tables in PostgreSQL:
    ```bash
    npx prisma migrate dev --name init
    ```

## 🏃‍♂️ Running the App

### Development Mode
```bash
npm run start:dev
```
The server will start at `http://localhost:3001`.

### Production Build
```bash
npm run build
npm run start:prod
```

## 📚 API Documentation

*(Suggested: Integrate Swagger for full interactive documentation)*
