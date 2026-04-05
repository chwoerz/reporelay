/**
 * Known source code strings used across parser + chunker + integration tests.
 * Having them in one place ensures consistency.
 */

export const TYPESCRIPT_SAMPLE = `
import { EventEmitter } from "node:events";

/**
 * Configuration options for the service.
 */
export interface ServiceConfig {
  name: string;
  port: number;
  debug?: boolean;
}

/** Status enum for lifecycle tracking. */
export enum Status {
  Idle = "idle",
  Running = "running",
  Stopped = "stopped",
}

/**
 * A simple service class that manages lifecycle.
 */
export class Service extends EventEmitter {
  private status: Status = Status.Idle;

  constructor(private readonly config: ServiceConfig) {
    super();
  }

  /** Start the service. */
  async start(): Promise<void> {
    this.status = Status.Running;
    this.emit("started", this.config.name);
  }

  /** Stop the service. */
  async stop(): Promise<void> {
    this.status = Status.Stopped;
    this.emit("stopped");
  }

  getStatus(): Status {
    return this.status;
  }
}

export type ServiceFactory = (config: ServiceConfig) => Service;

/** Default factory function. */
export const createService: ServiceFactory = (config) => new Service(config);

export default Service;
`.trimStart();

export const PYTHON_SAMPLE = `
"""A simple calculator module."""

from typing import List, Optional
from dataclasses import dataclass


@dataclass
class Result:
    """Holds a calculation result."""
    value: float
    operation: str


class Calculator:
    """A basic calculator with history tracking."""

    def __init__(self) -> None:
        self.history: List[Result] = []

    def add(self, a: float, b: float) -> Result:
        """Add two numbers."""
        result = Result(value=a + b, operation="add")
        self.history.append(result)
        return result

    def multiply(self, a: float, b: float) -> Result:
        """Multiply two numbers."""
        result = Result(value=a * b, operation="multiply")
        self.history.append(result)
        return result

    def last(self) -> Optional[Result]:
        """Return the last calculation result."""
        return self.history[-1] if self.history else None


def create_calculator() -> Calculator:
    """Factory function for Calculator."""
    return Calculator()
`.trimStart();

export const GO_SAMPLE = `
package server

import (
\t"context"
\t"net/http"
)

// Config holds server configuration.
type Config struct {
\tAddr string
\tPort int
}

// Server is an HTTP server wrapper.
type Server struct {
\tconfig Config
\thttp   *http.Server
}

// Handler defines a request handler interface.
type Handler interface {
\tServeHTTP(w http.ResponseWriter, r *http.Request)
}

// New creates a new Server with the given config.
func New(cfg Config) *Server {
\treturn &Server{config: cfg}
}

// Start starts the server.
func (s *Server) Start(ctx context.Context) error {
\ts.http = &http.Server{Addr: s.config.Addr}
\treturn s.http.ListenAndServe()
}

// Shutdown gracefully stops the server.
func (s *Server) Shutdown(ctx context.Context) error {
\treturn s.http.Shutdown(ctx)
}
`.trimStart();

export const JAVA_SAMPLE = `
package com.example.service;

import java.util.List;
import java.util.ArrayList;

/**
 * Represents a task in the system.
 */
public class Task {
    public enum Priority {
        LOW, MEDIUM, HIGH
    }

    private final String name;
    private Priority priority;

    public Task(String name, Priority priority) {
        this.name = name;
        this.priority = priority;
    }

    public String getName() {
        return name;
    }

    public Priority getPriority() {
        return priority;
    }

    public void setPriority(Priority priority) {
        this.priority = priority;
    }
}
`.trimStart();

export const KOTLIN_SAMPLE = `
package com.example.model

data class User(
    val id: Long,
    val name: String,
    val email: String,
)

interface UserRepository {
    fun findById(id: Long): User?
    fun findAll(): List<User>
    fun save(user: User): User
    fun delete(id: Long)
}

object UserValidator {
    fun validate(user: User): Boolean {
        return user.name.isNotBlank() && user.email.contains("@")
    }
}

fun User.displayName(): String = "\${name} <\${email}>"
`.trimStart();

export const RUST_SAMPLE = `
use std::collections::HashMap;

/// Configuration for the application.
#[derive(Debug, Clone)]
pub struct Config {
    pub name: String,
    pub settings: HashMap<String, String>,
}

/// Errors that can occur during processing.
#[derive(Debug)]
pub enum AppError {
    NotFound(String),
    InvalidInput(String),
}

/// A trait for things that can be processed.
pub trait Processor {
    fn process(&self, input: &str) -> Result<String, AppError>;
}

impl Config {
    /// Create a new config with the given name.
    pub fn new(name: impl Into<String>) -> Self {
        Config {
            name: name.into(),
            settings: HashMap::new(),
        }
    }

    /// Add a setting.
    pub fn set(&mut self, key: impl Into<String>, value: impl Into<String>) {
        self.settings.insert(key.into(), value.into());
    }
}

/// A simple processor implementation.
pub fn create_echo_processor() -> impl Processor {
    struct Echo;
    impl Processor for Echo {
        fn process(&self, input: &str) -> Result<String, AppError> {
            Ok(input.to_string())
        }
    }
    Echo
}
`.trimStart();

export const C_SAMPLE = `
#ifndef SERVER_H
#define SERVER_H

#include <stdio.h>
#include <stdlib.h>

typedef struct {
    char *host;
    int port;
} ServerConfig;

typedef struct {
    ServerConfig config;
    int running;
} Server;

Server *server_create(const char *host, int port);
int server_start(Server *server);
void server_stop(Server *server);
void server_destroy(Server *server);

#endif
`.trimStart();

export const CPP_SAMPLE = `
#pragma once

#include <string>
#include <vector>
#include <memory>

namespace reporelay {

class Logger {
public:
    enum class Level { Debug, Info, Warning, Error };

    explicit Logger(const std::string& name);
    ~Logger();

    void log(Level level, const std::string& message);
    void debug(const std::string& message);
    void info(const std::string& message);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

template<typename T>
class Registry {
public:
    void add(const std::string& name, std::shared_ptr<T> item);
    std::shared_ptr<T> get(const std::string& name) const;
    std::vector<std::string> list() const;

private:
    std::vector<std::pair<std::string, std::shared_ptr<T>>> items_;
};

} // namespace reporelay
`.trimStart();

export const MARKDOWN_SAMPLE = `
# Project Documentation

## Getting Started

This is the **introduction** to the project.

### Installation

\`\`\`bash
npm install my-library
\`\`\`

### Configuration

Set the following environment variables:

- \`API_KEY\` — your API key
- \`DEBUG\` — enable debug mode

## API Reference

### \`createClient(options)\`

Creates a new client instance.

\`\`\`typescript
const client = createClient({ apiKey: "..." });
\`\`\`

### \`client.query(sql)\`

Executes a SQL query and returns results.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for details.
`.trimStart();

/**
 * Returns a Record<path, content> suitable for createTestRepo(),
 * covering all supported languages.
 */
export function allLanguageFiles(): Record<string, string> {
  return {
    "src/service.ts": TYPESCRIPT_SAMPLE,
    "src/calculator.py": PYTHON_SAMPLE,
    "src/server.go": GO_SAMPLE,
    "src/Task.java": JAVA_SAMPLE,
    "src/model.kt": KOTLIN_SAMPLE,
    "src/config.rs": RUST_SAMPLE,
    "src/server.h": C_SAMPLE,
    "src/logger.hpp": CPP_SAMPLE,
    "docs/README.md": MARKDOWN_SAMPLE,
    "package.json": '{ "name": "test-project" }',
    "assets/logo.png": "binary-content-ignored",
  };
}
