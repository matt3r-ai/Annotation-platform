data "nomad_plugin" "ebs" {
  plugin_id        = "aws-ebs0"
  wait_for_healthy = true
}

resource "nomad_csi_volume" "ap-frontend-volume" {
  depends_on = [data.nomad_plugin.ebs]

  plugin_id    = "aws-ebs0"
  volume_id    = "ap-frontend-volume"
  name         = "ap-frontend-volume"
  capacity_min = "8GiB"
  capacity_max = "8GiB"

  capability {
    access_mode     = "single-node-writer"
    attachment_mode = "file-system"
  }

  parameters = {
    type = "gp2" 
  }

  mount_options {
    fs_type = "ext4"
  }
}

resource "nomad_csi_volume" "ap-backend-volume" {
  depends_on = [data.nomad_plugin.ebs]

  plugin_id    = "aws-ebs0"
  volume_id    = "ap-backend-volume"
  name         = "ap-backend-volume"
  capacity_min = "8GiB"
  capacity_max = "8GiB"

  capability {
    access_mode     = "single-node-writer"
    attachment_mode = "file-system"
  }

  parameters = {
    type = "gp2" 
  }

  mount_options {
    fs_type = "ext4"
  }
}
