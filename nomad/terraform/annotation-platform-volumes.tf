data "nomad_plugin" "ebs" {
  plugin_id        = "aws-ebs0"
  wait_for_healthy = true
}

resource "nomad_csi_volume" "annotation-platform-backend-volume" {
  depends_on = [data.nomad_plugin.ebs]

  plugin_id    = "aws-ebs0"
  volume_id    = "annotation-platform-backend-volume"
  name         = "annotation-platform-backend-volume"
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
