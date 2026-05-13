# ♔ Multiplayer Chess System (PDC Evaluation) ♚

A high-performance, real-time multiplayer chess platform built to evaluate **Parallel and Distributed Computing (PDC)** principles using a **Master-Worker architecture**.

---

## 🚀 Key Features

*   **Real-time Multiplayer**: Powered by Socket.io for low-latency game state synchronization.
*   **Advanced Game Modes**:
    *   **Regular Chess**: Standard international rules.
    *   **Powered King**: A chaotic mode where kings have special abilities: *Freeze*, *Teleport*, and *Swap*.
    *   **Fog of War**: A strategic mode where you can only see squares reachable by your pieces.
*   **Parallel Move Validation**: Move legality is computed by dedicated worker processes to ensure the main thread remains responsive.
*   **Performance Dashboard**: Live monitoring of system throughput, worker counts, and IPC (Inter-Process Communication) latency.
*   **Match Review**: Replay and analyze your matches move-by-move after the game concludes.
*   **Reconnection Support**: Session persistence allows players to rejoin matches after accidental disconnections.

---

## 🏗 Architecture & PDC Implementation

The system utilizes the **Node.js Cluster Module** to implement a **Master-Worker Pattern**, fulfilling requirements for Task Parallelism and Asynchronous IPC.

### Master Process (The Coordinator)
*   **Role**: Handles all HTTP and WebSocket traffic.
*   **Responsibility**: Manages game rooms, player matchmaking (queueing), and coordinates data for the metrics dashboard.
*   **Traffic Control**: When a move is received, the Master delegates the validation task to a worker.

### Worker Processes (The Computing Nodes)
*   **Role**: Perform CPU-intensive chess logic.
*   **Responsibility**: Execute complex legal move validations, checkmate detection, and board state analysis.
*   **Scaling**: Automatically forks multiple workers based on the host system's CPU core count (`os.cpus().length`).

### IPC Communication Flow
1.  **Request**: Master sends `VALIDATE_MOVE` payload to a Worker via `worker.send()`.
2.  **Computation**: Worker processes the logic independently of the I/O thread.
3.  **Response**: Worker sends `VALIDATION_RESULT` back to the Master via `process.send()`.

---

## 📊 Performance Monitoring

The system includes a **PDC Dashboard** accessible at `/dashboard`. It visualizes:
*   **Active Computing Workers**: Number of parallel nodes currently online.
*   **Throughput**: Moves processed per second/minute.
*   **IPC Latency**: The round-trip time for a move validation request to be processed by a worker.
*   **System Uptime**: Total availability of the coordinator.

---

## 🛠 Tech Stack

*   **Backend**: Node.js, Express
*   **Communication**: Socket.io (WebSockets)
*   **Parallelism**: Node.js Cluster Module
*   **Frontend**: Vanilla JS, HTML5, CSS3 (Glassmorphism UI)
*   **Charts**: Chart.js for real-time metrics

---

## 🚦 Getting Started

### Prerequisites
*   [Node.js](https://nodejs.org/) (v14 or higher)
*   npm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Drei-i/MultiplayerGameChess.git
   cd MultiplayerGameChess
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the system:
   ```bash
   npm start
   ```
4. Open your browser:
   *   Game: `http://localhost:3000`
   *   Dashboard: `http://localhost:3000/dashboard`

---

## 👥 Authors (Team PDC)
*   **Rabaya**
*   **Quejada**
*   **Libutan**
*   **Tuazon**
*   **Bajarla**

---
*Developed for PDC Course Evaluation - 2026*
