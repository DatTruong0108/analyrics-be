# Analyrics Backend 🎵🤖

**Analyrics** is a powerful song analysis platform that uses Artificial Intelligence to interpret lyrics, providing insights into vibes, hidden meanings, and cultural context. This repository contains the **Backend API** built with **NestJS**.

## 🚀 Features

-   **AI-Powered Analysis**: Uses **Google Gemini 2.5 Flash** to analyze lyrics for vibe, metaphors, and core messages.
-   **Song Data**: Integrates with **LrcLib** to fetch accurate lyrics and **Spotify** to fetch accurate metadata.
-   **Authentication**: Secure JWT-based authentication (Passport + Bcrypt) for user management.
-   **Database**: robust data persistence using **PostgreSQL** and **Prisma ORM**.

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
*   Spotify Client ID and Client Secret ([Get it here](https://developer.spotify.com/dashboard/))

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
    BE_URL="http://localhost:3001"
    FE_URL=
    FE_URL_PROD=
    BE_URL_PROD=
    BE_PORT="3001"
    
    # Database
    DATABASE_URL="postgresql://user:password@localhost:5432/analyrics_db?schema=public"

    # Variables
    NODE_ENV="development"
    
    # JWT Auth
    JWT_SECRET="your_super_secret_jwt_key"
    JWT_EXPIRES_IN="7d"
    
    # External APIs
    AI_API_KEY="your_google_gemini_api_key"
    GET_LYRICS_API="api_url_to_get_lyrics"

    # Spotify configuration
    SPOTIFY_CLIENT_ID=
    SPOTIFY_CLIENT_SECRET=
    SPOTIFY_AUTH_URL="https://accounts.spotify.com/api/token"
    SPOTIFY_SEARCH_URL="https://api.spotify.com/v1/search"
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
