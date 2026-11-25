use crate::error::{AppError, AppResult};
use crate::models::ServerMetrics;

/// 轻量化 POSIX 远程主机监控信息采集脚本（兼容主流 Linux 发行版与 macOS）
pub const METRICS_PROBE_CMD: &str = r#"
HOST=$(hostname 2>/dev/null || echo unknown)
OS=$( (grep -m1 PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"') || uname -s )
KERNEL=$(uname -r 2>/dev/null || echo unknown)
UPTIME=$(awk '{print int($1)}' /proc/uptime 2>/dev/null || echo 0)
LOAD=$(cat /proc/loadavg 2>/dev/null | awk '{print $1,$2,$3}' || uptime | awk -F'load averages?: ' '{print $2}' | tr -d ',')
CPU=$(top -bn1 2>/dev/null | awk '/Cpu\(s\)|%Cpu/{for(i=1;i<=NF;i++) if($i~/id,?$/) {gsub(/[^0-9.]/,"",$(i-1)); printf "%.1f", 100-$(i-1); exit}}' || echo 0)
MEM=$(free -b 2>/dev/null | awk '/Mem:/{print $2,$3}' || echo "0 0")
DISK=$(df -B1 / 2>/dev/null | awk 'NR==2{print $2,$3}' || df -k / 2>/dev/null | awk 'NR==2{print $2*1024,$3*1024}')
printf "HOST=%s\nOS=%s\nKERNEL=%s\nUPTIME=%s\nLOAD=%s\nCPU=%s\nMEM=%s\nDISK=%s\n" "$HOST" "$OS" "$KERNEL" "$UPTIME" "$LOAD" "$CPU" "$MEM" "$DISK"
"#;

/// 解析远程监控命令输出的键值对为结构化指标对象
pub fn parse_metrics_output(raw: &str) -> AppResult<ServerMetrics> {
    let mut hostname = String::from("unknown");
    let mut os_name = String::from("Linux");
    let mut kernel = String::from("unknown");
    let mut uptime_seconds: u64 = 0;
    let mut load_avg = [0.0_f64; 3];
    let mut cpu_usage_percent: f64 = 0.0;
    let mut memory_total_bytes: u64 = 0;
    let mut memory_used_bytes: u64 = 0;
    let mut disk_total_bytes: u64 = 0;
    let mut disk_used_bytes: u64 = 0;
    let mut parsed_fields = 0usize;

    for line in raw.lines() {
        let Some((k, v)) = line.trim().split_once('=') else {
            continue;
        };
        let v = v.trim();
        parsed_fields += 1;
        match k {
            "HOST" if !v.is_empty() => hostname = v.to_string(),
            "OS" if !v.is_empty() => os_name = v.to_string(),
            "KERNEL" if !v.is_empty() => kernel = v.to_string(),
            "UPTIME" => uptime_seconds = v.parse().unwrap_or(0),
            "LOAD" => {
                let nums: Vec<f64> = v
                    .split_whitespace()
                    .take(3)
                    .filter_map(|s| s.parse::<f64>().ok())
                    .collect();
                if nums.len() == 3 {
                    load_avg = [nums[0], nums[1], nums[2]];
                }
            }
            "CPU" => cpu_usage_percent = v.parse::<f64>().unwrap_or(0.0).clamp(0.0, 100.0),
            "MEM" => {
                let nums: Vec<u64> = v
                    .split_whitespace()
                    .filter_map(|s| s.parse::<u64>().ok())
                    .collect();
                if nums.len() >= 2 {
                    memory_total_bytes = nums[0];
                    memory_used_bytes = nums[1];
                }
            }
            "DISK" => {
                let nums: Vec<u64> = v
                    .split_whitespace()
                    .filter_map(|s| s.parse::<u64>().ok())
                    .collect();
                if nums.len() >= 2 {
                    disk_total_bytes = nums[0];
                    disk_used_bytes = nums[1];
                }
            }
            _ => {}
        }
    }

    if parsed_fields == 0 {
        return Err(AppError::Ssh("未能解析到任何有效的服务器监控输出".into()));
    }

    Ok(ServerMetrics {
        hostname,
        os_name,
        kernel,
        uptime_seconds,
        load_avg,
        cpu_usage_percent,
        memory_total_bytes,
        memory_used_bytes,
        disk_total_bytes,
        disk_used_bytes,
        collected_at: chrono::Utc::now().timestamp(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_linux_metrics_output() {
        let sample = "\
HOST=prod-gateway-01
OS=Ubuntu 24.04.1 LTS
KERNEL=6.8.0-45-generic
UPTIME=172890
LOAD=0.42 0.38 0.31
CPU=18.4
MEM=17179869184 6442450944
DISK=107374182400 42949672960
";
        let metrics = parse_metrics_output(sample).unwrap();
        assert_eq!(metrics.hostname, "prod-gateway-01");
        assert_eq!(metrics.os_name, "Ubuntu 24.04.1 LTS");
        assert_eq!(metrics.kernel, "6.8.0-45-generic");
        assert_eq!(metrics.uptime_seconds, 172890);
        assert_eq!(metrics.load_avg, [0.42, 0.38, 0.31]);
        assert!((metrics.cpu_usage_percent - 18.4).abs() < f64::EPSILON);
        assert_eq!(metrics.memory_total_bytes, 17_179_869_184);
        assert_eq!(metrics.memory_used_bytes, 6_442_450_944);
        assert_eq!(metrics.disk_total_bytes, 107_374_182_400);
        assert_eq!(metrics.disk_used_bytes, 42_949_672_960);
    }

    #[test]
    fn test_parse_empty_output_returns_error() {
        assert!(parse_metrics_output("not valid metrics").is_err());
    }
}
