variable "project_id" {
  description = "Existing Google Cloud project ID with billing enabled."
  type        = string
  default     = "alorun"
}

variable "region" {
  description = "Google Cloud region for Cloud Run."
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  type    = string
  default = "alorun-chat"
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{0,20}[a-z0-9]$", var.service_name))
    error_message = "Use 2-22 lowercase letters, digits or hyphens, starting with a letter and ending with a letter or digit."
  }
}

variable "container_image" {
  description = "Immutable container image URL, including digest, already available to Cloud Run."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.container_image))
    error_message = "Use a container image pinned by sha256 digest."
  }
}

variable "backend_secret_id" {
  description = "ID of an existing Secret Manager secret containing dotenv-formatted backend settings."
  type        = string
  default     = "backend-secrets"
}

variable "backend_secret_version" {
  description = "Enabled Secret Manager version to mount. Pin a version for reproducible deployments."
  type        = string
  default     = "latest"
}

variable "allow_public_invocation" {
  description = "Allow clients to reach the service without Google IAM. Supabase authentication is still required by the application."
  type        = bool
  default     = false
}

variable "max_instances" {
  type    = number
  default = 2
  validation {
    condition     = var.max_instances >= 1 && var.max_instances <= 10 && floor(var.max_instances) == var.max_instances
    error_message = "max_instances must be an integer between 1 and 10."
  }
}
