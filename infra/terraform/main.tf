locals {
  apis = toset([
    "run.googleapis.com",
    "iam.googleapis.com",
    "secretmanager.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each           = local.apis
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_service_account" "runtime" {
  account_id   = "${var.service_name}-runtime"
  display_name = "Alorun chat Cloud Run runtime"
  depends_on   = [google_project_service.required]
}

resource "google_secret_manager_secret_iam_member" "backend_access" {
  project   = var.project_id
  secret_id = var.backend_secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}

resource "google_cloud_run_v2_service" "chat" {
  name                = var.service_name
  location            = var.region
  ingress             = "INGRESS_TRAFFIC_ALL"
  deletion_protection = true

  template {
    service_account                  = google_service_account.runtime.email
    max_instance_request_concurrency = 20
    timeout                          = "70s"

    scaling {
      min_instance_count = 0
      max_instance_count = var.max_instances
    }

    volumes {
      name = "backend-secrets"
      secret {
        secret = var.backend_secret_id
        items {
          version = var.backend_secret_version
          path    = "backend.env"
        }
      }
    }

    containers {
      image = var.container_image
      ports { container_port = 8080 }
      resources {
        limits = { cpu = "1", memory = "512Mi" }
      }
      env {
        name  = "BACKEND_SECRETS_FILE"
        value = "/secrets/backend/backend.env"
      }
      volume_mounts {
        name       = "backend-secrets"
        mount_path = "/secrets/backend"
      }
      startup_probe {
        tcp_socket { port = 8080 }
        initial_delay_seconds = 0
        timeout_seconds       = 5
        period_seconds        = 10
        failure_threshold     = 3
      }
    }
  }
  depends_on = [google_project_service.required, google_secret_manager_secret_iam_member.backend_access]
}

# The mobile app authenticates with Supabase, not a Google identity token.
resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  count    = var.allow_public_invocation ? 1 : 0
  project  = var.project_id
  location = var.region
  name     = google_cloud_run_v2_service.chat.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
